// Codex-powered per-card usage tips (plan §7 row 'tips'). Manual-only job.
//
// Selects active, non-token cards without a tip (--force also regenerates source='codex' tips, never 'user'),
// groups identical printings (same name + type + rules text → one Codex entry, tip written to every printing),
// asks `codex exec` in batches for schema-constrained JSON, post-processes (≤50 words / ≤400 chars) and
// upserts `tips` one tx per batch with a `tips {count}` change row so connected clients refresh.
// Resumable by construction: a rerun only sees cards that still lack a tip.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { JobCtx, JobFlags, JobResult } from './types.ts';
import type { Logger } from '../server/log.ts';
import type { Db } from '../server/db/open.ts';
import { all, nowIso, one, run as dbRun } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';
import { atomicWrite, ensureDir, writeJsonFile } from './lib/files.ts';
import { sleep } from './lib/http.ts';
import { DOMAINS } from '../shared/constants.ts';
import { normalizeCommunityId } from '../shared/ids.ts';
import type { TipsPayload } from '../shared/types.ts';

export const MAX_TIP_WORDS = 50;
export const MAX_TIP_CHARS = 400;
const DEFAULT_BATCH = 20;
const MAX_BATCH = 100;
const CODEX_TIMEOUT_MS = 5 * 60 * 1000;
const VERSION_TIMEOUT_MS = 30 * 1000;
const MAX_MISSING_RETRIES = 2; // a card the model skipped is re-asked up to twice
const MAX_BATCH_FAILURES = 2; // a failed batch is retried once (halved), then its cards are recorded as failed
const PAUSE_MS = 1000;

/** JSON schema handed to `codex exec --output-schema` (strict: additionalProperties false, all props required). */
export const TIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tips'],
  properties: {
    tips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tip'],
        properties: { id: { type: 'string' }, tip: { type: 'string', maxLength: 320 } },
      },
    },
  },
} as const;

export interface TipCard {
  id: string;
  name: string;
  type: string | null;
  supertype: string | null;
  domains: string[];
  energy: number | null;
  might: number | null;
  power: number | null;
  rarity: string | null;
  rules_text: string | null;
}

/** Printings that share name + type + rules text; Codex is asked once (rep), the tip is written to every id. */
export interface TipGroup {
  key: string;
  rep: TipCard;
  ids: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested in server/test/tips.test.ts)
// ---------------------------------------------------------------------------------------------------------------

const GLOSSARY: ReadonlyArray<readonly [string, string]> = [
  ['Action', 'a spell or ability you can only use on your own turn while nothing else is resolving (sorcery speed).'],
  ['Reaction', 'a spell or ability you can use in response to other plays, including during a showdown, on either player\'s turn.'],
  ['Showdown', 'combat at a battlefield between both players\' units there; total Might decides who holds or takes the battlefield and scores.'],
  ['Accelerate', 'lets the card be played at a faster timing than its type normally allows (e.g. as a Reaction), sometimes for an extra cost — good for surprise plays.'],
  ['Assault N', 'the unit gains +N Might while it is attacking.'],
  ['Tank', 'the unit has to be dealt with first: enemies must damage or choose it before other friendly units at that battlefield.'],
  ['Shield', 'protects the unit from the next damage or kill effect once; the shield is then used up.'],
  ['Deflect N', 'enemy spells and abilities that would choose this unit cost N more to play.'],
  ['Hidden', 'the card is concealed from the opponent until it acts or is revealed, so it is hard to plan around or choose.'],
  ['Temporary', 'the unit or effect only lasts until the end of the turn and then leaves play.'],
  ['Vision', 'look at the top card(s) of your deck and decide what to keep on top or set aside (card selection).'],
  ['Deathknell', 'a triggered effect that happens when the unit dies / is killed.'],
  ['Legion', 'a bonus that applies while you control (or have played) other friendly units — rewards going wide.'],
  ['Ganking', 'the unit can move into a battlefield where a showdown is already happening, joining the fight from elsewhere.'],
  ['Empower / Empowered', 'a lasting buff on a unit (more Might and/or an extra effect); "Empowered" units carry that buff.'],
  ['Flow', 'a repeatable effect that triggers or grows as you keep playing cards/spells during a turn — rewards chaining plays.'],
  ['Quick', 'the unit can act (move or attack) the turn it enters play instead of waiting.'],
  ['Exhaust / Ready', 'exhaust = turn the card sideways to pay for an attack or ability; it cannot be used again until it readies at the start of your next turn.'],
  ['Energy / Power', 'Energy is the generic cost paid from channelled runes; Power is the domain-coloured requirement paid from matching runes.'],
  ['Might', 'combat strength; the side with more total Might wins a showdown.'],
];

function normWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function fmtNum(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? '-' : String(n);
}

function domainLabel(id: string): string {
  const d = DOMAINS[id.toLowerCase()];
  return d ? d.label : id.charAt(0).toUpperCase() + id.slice(1);
}

/** One prompt line per card: '- id: OGN-012 | name | type | supertype | domains | energy | might | power | rarity | rules: ...' */
export function cardLine(c: TipCard): string {
  const domains = c.domains.length ? c.domains.map(domainLabel).join('/') : '-';
  const rules = c.rules_text && normWs(c.rules_text) ? normWs(c.rules_text) : '(no rules text)';
  return `- id: ${c.id} | ${normWs(c.name)} | ${c.type ?? '-'} | ${c.supertype ?? '-'} | ${domains} | energy ${fmtNum(c.energy)} | might ${fmtNum(c.might)} | power ${fmtNum(c.power)} | ${c.rarity ?? '-'} | rules: ${rules}`;
}

/** Full Codex prompt for one batch: coach persona + rules + keyword glossary + card lines. */
export function buildPrompt(cards: TipCard[]): string {
  const lines: string[] = [
    'You are an expert coach for Riftbound, the League of Legends trading card game by Riot Games.',
    'For EACH card listed below, write ONE practical tip for a player who has that card in their deck.',
    'You do not need tools or files for this task: answer directly from the information in this message.',
    '',
    'Rules for every tip:',
    '- Max 45 words. One short paragraph of plain text: no markdown, no bullets, no line breaks, no quotation marks.',
    '- Imperative voice addressed to the player ("Hold it until...", "Play it when..."). Do not repeat the card\'s name.',
    '- Cover: when to play it, what it combos with or answers, and one common mistake to avoid.',
    "- Use ONLY the card's own rules text and the keyword glossary below. Do not invent mechanics, numbers, card names or interactions that are not implied by the text.",
    '- If a card has no rules text (e.g. a basic rune or vanilla unit), advise on tempo, curve, domain identity or deck building instead.',
    '- Return JSON matching the provided schema: {"tips":[{"id":"...","tip":"..."}]} — exactly one entry per card id, ids copied exactly as given, every id present. Output nothing else.',
    '',
    'Keyword glossary (approximate; when a card prints its own reminder text, prefer that):',
    ...GLOSSARY.map(([k, v]) => `- ${k}: ${v}`),
    '',
    'Notation inside rules text: [N] or :rb_energy_N: = N Energy; [>] or :rb_exhaust: = exhaust this card; :rb_rune_<domain>: or Power = coloured rune requirement; "Recall" = return a unit to hand; "Kill" = remove a unit; "Channel" = turn a rune to gain Energy/Power.',
    '',
    `Cards (${cards.length}). Line format: - id: <id> | name | type | supertype | domains | energy | might | power | rarity | rules: <text>`,
    ...cards.map(cardLine),
  ];
  return lines.join('\n') + '\n';
}

function cutWords(words: string[], max: number): string {
  const head = words.slice(0, max);
  for (let i = head.length - 1; i >= 0; i--) {
    if (/[.!?]["”'’)\]]*$/.test(head[i])) return head.slice(0, i + 1).join(' ');
  }
  return head.join(' ').replace(/[\s,;:–—-]+$/, '');
}

function cutChars(s: string, max: number): string {
  const head = s.slice(0, max);
  const m = head.match(/^[\s\S]*[.!?]["”'’)\]]*(?=\s|$)/);
  if (m && m[0].trim()) return m[0].trim();
  const sp = head.lastIndexOf(' ');
  return (sp > 0 ? head.slice(0, sp) : head).replace(/[\s,;:–—-]+$/, '');
}

/**
 * Normalise a tip: collapse whitespace, strip wrapping quotes / list markers, then enforce ≤ maxWords
 * (cut at the last sentence end within the limit, else hard-cut) and ≤ maxChars.
 */
export function clampWords(text: string, maxWords = MAX_TIP_WORDS, maxChars = MAX_TIP_CHARS): string {
  let s = normWs(String(text ?? ''));
  if (/^["“'‘`]/.test(s) && /["”'’`]$/.test(s)) s = s.slice(1, -1).trim();
  s = s.replace(/^(?:[-*•]|\d+[.)])\s+/, '');
  if (!s) return '';
  const words = s.split(' ');
  if (words.length > maxWords) s = cutWords(words, maxWords);
  if (s.length > maxChars) s = cutChars(s, maxChars);
  return s;
}

export interface ParsedTips {
  /** id → cleaned tip (only ids from the batch, first occurrence wins) */
  tips: Map<string, string>;
  /** batch ids the model did not return (or returned empty/invalid) */
  missing: string[];
  /** ids returned by the model that were not in the batch */
  unknown: string[];
}

/** Parse `codex -o` output: strip ``` fences, slice first '{' .. last '}', JSON.parse, validate ids ⊆ batch, clean tips. Throws on invalid JSON/shape. */
export function parseCodexOutput(raw: string, batchIds: Iterable<string>): ParsedTips {
  const allowed = new Set<string>();
  const byLower = new Map<string, string>();
  for (const id of batchIds) {
    allowed.add(id);
    byLower.set(id.toLowerCase(), id);
  }
  let s = String(raw ?? '');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // UTF-8 BOM
  s = s.replace(/```[a-zA-Z0-9_-]*/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object found in codex output');
  s = s.slice(a, b + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch (e) {
    throw new Error(`invalid JSON in codex output: ${(e as Error).message}`);
  }
  const list = (obj as { tips?: unknown } | null)?.tips;
  if (!Array.isArray(list)) throw new Error('codex output has no "tips" array');
  const tips = new Map<string, string>();
  const unknown: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rawId = String((item as { id?: unknown }).id ?? '').trim();
    const id = allowed.has(rawId) ? rawId : byLower.get(rawId.toLowerCase());
    if (!id) {
      if (rawId) unknown.push(rawId);
      continue;
    }
    const tipRaw = (item as { tip?: unknown }).tip;
    if (typeof tipRaw !== 'string') continue;
    const tip = clampWords(tipRaw);
    if (tip && !tips.has(id)) tips.set(id, tip);
  }
  const missing = [...allowed].filter((id) => !tips.has(id));
  return { tips, missing, unknown };
}

/** Group printings with identical name + type + rules text (alt arts, signatures, showcase, rune reprints). Keeps input order; first printing is the representative. */
export function groupCards(cards: TipCard[]): TipGroup[] {
  const groups = new Map<string, TipGroup>();
  for (const c of cards) {
    const key = `${normWs(c.name).toLowerCase()}|${(c.type ?? '').toLowerCase()}|${normWs(c.rules_text ?? '').toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.ids.push(c.id);
    else groups.set(key, { key, rep: c, ids: [c.id] });
  }
  return [...groups.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------------------------------------------

interface CardRow {
  id: string;
  name: string;
  type: string | null;
  supertype: string | null;
  domains: string;
  energy: number | null;
  might: number | null;
  power: number | null;
  rarity: string | null;
  rules_text: string | null;
}

function whereClause(flags: JobFlags): { where: string; params: unknown[] } {
  const where = [`c.active = 1`, `COALESCE(c.type, '') <> 'Token'`, `COALESCE(c.supertype, '') <> 'Token'`];
  const params: unknown[] = [];
  where.push(flags.force ? `(t.card_id IS NULL OR t.source = 'codex')` : `t.card_id IS NULL`);
  if (Array.isArray(flags.ids) && flags.ids.length) {
    const ids = flags.ids.map((s) => normalizeCommunityId(String(s)) ?? String(s).trim());
    where.push(`c.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  return { where: where.join(' AND '), params };
}

const FROM = `FROM cards c LEFT JOIN tips t ON t.card_id = c.id LEFT JOIN sets s ON s.code = c.set_code`;

function selectCards(db: Db, flags: JobFlags): TipCard[] {
  const { where, params } = whereClause(flags);
  const limit = typeof flags.limit === 'number' && flags.limit > 0 ? Math.floor(flags.limit) : null;
  const rows = all<CardRow>(
    db,
    `SELECT c.id, c.name, c.type, c.supertype, c.domains, c.energy, c.might, c.power, c.rarity, c.rules_text
     ${FROM} WHERE ${where}
     ORDER BY COALESCE(s.sort_order, 0), c.set_code, c.number_int, c.number${limit ? ` LIMIT ${limit}` : ''}`,
    ...params,
  );
  return rows.map((r) => {
    let domains: string[] = [];
    try {
      const d = JSON.parse(r.domains || '[]');
      if (Array.isArray(d)) domains = d.map(String);
    } catch {
      /* keep [] */
    }
    return { ...r, domains };
  });
}

function countRemaining(db: Db, flags: JobFlags): number {
  const { where, params } = whereClause({ force: flags.force });
  return Number(one<{ n: number }>(db, `SELECT COUNT(*) AS n ${FROM} WHERE ${where}`, ...params)?.n ?? 0);
}

const UPSERT = `INSERT INTO tips(card_id, text, source, model, generated_at, edited_at, edited_by)
  VALUES (?, ?, 'codex', ?, ?, NULL, NULL)
  ON CONFLICT(card_id) DO UPDATE SET text = excluded.text, source = 'codex', model = excluded.model,
    generated_at = excluded.generated_at, edited_at = NULL, edited_by = NULL
  WHERE tips.source <> 'user'`;

/** Upsert tips for the given groups in ONE tx (+ one `tips {count}` change row). Returns rows written. */
function writeTips(db: Db, entries: Array<{ ids: string[]; tip: string }>, model: string): number {
  return db.tx(() => {
    const now = nowIso();
    let n = 0;
    for (const e of entries) for (const id of e.ids) n += dbRun(db, UPSERT, id, e.tip, model, now).changes;
    if (n > 0) {
      const payload: TipsPayload = { count: n };
      insertChange(db, { kind: 'tips', reason: 'codex', payload });
    }
    return n;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Codex CLI
// ---------------------------------------------------------------------------------------------------------------

interface ProcResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  errno: string | null;
  error: string | null;
}

interface ProcOpts {
  cwd?: string;
  stdin?: string;
  captureStdout?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

function quoteArg(s: string): string {
  return /[\s"&|<>^()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function spawnOnce(cmd: string, args: string[], o: ProcOpts, shell: boolean): Promise<ProcResult> {
  return new Promise((resolve) => {
    const res: ProcResult = { code: null, signal: null, stdout: '', stderr: '', timedOut: false, aborted: false, errno: null, error: null };
    const stdio: Array<'pipe' | 'ignore'> = ['pipe', o.captureStdout ? 'pipe' : 'ignore', 'pipe'];
    let child: ChildProcess;
    try {
      child = shell
        ? spawn([cmd, ...args].map(quoteArg).join(' '), { cwd: o.cwd, stdio, shell: true, windowsHide: true })
        : spawn(cmd, args, { cwd: o.cwd, stdio, windowsHide: true });
    } catch (e) {
      res.errno = (e as NodeJS.ErrnoException).code ?? null;
      res.error = (e as Error).message;
      resolve(res);
      return;
    }
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on('data', (d: Buffer) => out.push(d));
    child.stderr?.on('data', (d: Buffer) => err.push(d));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      res.stdout = Buffer.concat(out).toString('utf8');
      res.stderr = Buffer.concat(err).toString('utf8');
      resolve(res);
    };
    const timer = setTimeout(() => {
      res.timedOut = true;
      res.error = `timed out after ${Math.round(o.timeoutMs / 1000)} s`;
      child.kill();
    }, o.timeoutMs);
    const onAbort = () => {
      res.aborted = true;
      res.error = 'aborted';
      child.kill();
    };
    o.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e: NodeJS.ErrnoException) => {
      res.errno = e.code ?? null;
      res.error = e.message;
      finish();
    });
    child.on('close', (code, signal) => {
      res.code = code;
      res.signal = signal;
      finish();
    });
    if (child.stdin) {
      child.stdin.on('error', () => {
        /* EPIPE when the child exits early — the exit code tells the story */
      });
      child.stdin.end(o.stdin ?? '');
    }
  });
}

/** Run the codex CLI; if `codex` (codex.exe) is not on PATH, retry as `codex.cmd` through the shell. */
async function codexCli(args: string[], o: ProcOpts, log: Logger): Promise<ProcResult> {
  const r = await spawnOnce('codex', args, o, false);
  if (r.errno === 'ENOENT') {
    log.warn('`codex` not found on PATH; retrying with codex.cmd via shell');
    return spawnOnce('codex.cmd', args, o, true);
  }
  return r;
}

async function codexVersion(log: Logger): Promise<string> {
  const r = await codexCli(['--version'], { captureStdout: true, timeoutMs: VERSION_TIMEOUT_MS }, log);
  const line = r.stdout.trim().split(/\r?\n/)[0]?.trim();
  if (r.code === 0 && line) return line;
  if (r.errno === 'ENOENT') throw new Error('codex CLI not found on PATH (install Codex CLI or add it to PATH)');
  log.warn(`codex --version failed (${r.error ?? `exit ${r.code}`}); recording model as "codex-cli"`);
  return 'codex-cli';
}

// ---------------------------------------------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------------------------------------------

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : dflt;
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, cfg, log, flags } = ctx;
  const t0 = Date.now();
  const batchSize = clampInt(flags.batch, 1, MAX_BATCH, DEFAULT_BATCH);
  const maxBatches = clampInt(flags.maxBatches, 1, 1e6, 0);
  const force = Boolean(flags.force);

  const cards = selectCards(db, flags);
  if (!cards.length) {
    const hint = Array.isArray(flags.ids) && flags.ids.length ? ' (given ids unknown, inactive, tokens or already tipped — add --force to regenerate codex tips)' : force ? '' : ' (use --force to regenerate codex-written tips; user edits are never overwritten)';
    return { ok: 0, failed: 0, message: `nothing to do: no cards without tips${hint}`, changed: false };
  }
  let groups = groupCards(cards);
  if (maxBatches) groups = groups.slice(0, maxBatches * batchSize);
  const total = groups.reduce((n, g) => n + g.ids.length, 0);

  ensureDir(cfg.tipsDir);
  const schemaPath = path.join(cfg.tipsDir, 'schema.json');
  writeJsonFile(schemaPath, TIP_SCHEMA);
  const failedPath = path.join(cfg.tipsDir, 'failed.json');

  if (flags.dryRun) {
    const prompt = buildPrompt(groups.slice(0, batchSize).map((g) => g.rep));
    atomicWrite(path.join(cfg.tipsDir, 'batch-001.prompt.txt'), prompt);
    console.log(prompt);
    const msg = `dry run: ${groups.length} unique cards (${total} printings) queued in ${Math.ceil(groups.length / batchSize)} batches of ${batchSize}; first prompt printed (${prompt.length} chars)`;
    log.info(msg);
    return { ok: 0, failed: 0, message: msg, changed: false };
  }

  const version = await codexVersion(log);
  let model = cfg.codexModel ? `${version} ${cfg.codexModel}` : version;
  log.info(`${groups.length} unique cards / ${total} printings to tip, batch ${batchSize}${maxBatches ? `, max ${maxBatches} batches` : ''}, ${model}`);
  if (fs.existsSync(failedPath)) fs.unlinkSync(failedPath);

  const batches: TipGroup[][] = chunk(groups, batchSize);
  const requeue: TipGroup[] = [];
  const missingTries = new Map<string, number>();
  const failTries = new Map<string, number>();
  const failed: Array<{ id: string; name: string; reason: string }> = [];
  let written = 0;
  let uniqueOk = 0;
  let done = 0;
  let invocations = 0;
  let retries = 0;
  let aborted = false;

  const failGroup = (g: TipGroup, reason: string) => {
    for (const id of g.ids) failed.push({ id, name: g.rep.name, reason });
    done += g.ids.length;
  };

  while (batches.length || requeue.length) {
    if (ctx.signal.aborted) {
      aborted = true;
      break;
    }
    if (!batches.length) batches.push(...chunk(requeue.splice(0), batchSize));
    const batch = batches.shift()!;
    invocations++;
    const nnn = String(invocations).padStart(3, '0');
    const promptPath = path.join(cfg.tipsDir, `batch-${nnn}.prompt.txt`);
    const outPath = path.join(cfg.tipsDir, `batch-${nnn}.out.json`);
    const logPath = path.join(cfg.tipsDir, `batch-${nnn}.log`);
    const prompt = buildPrompt(batch.map((g) => g.rep));
    atomicWrite(promptPath, prompt);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '-s',
      'read-only',
      '-C',
      cfg.tipsDir,
      '--color',
      'never',
      '--output-schema',
      schemaPath,
      '-o',
      outPath,
      ...(cfg.codexModel ? ['-m', cfg.codexModel] : []),
      '-',
    ];
    const tb = Date.now();
    const res = await codexCli(args, { cwd: cfg.tipsDir, stdin: prompt, timeoutMs: CODEX_TIMEOUT_MS, signal: ctx.signal }, log);
    const secs = ((Date.now() - tb) / 1000).toFixed(1);
    // codex prints a header ("model: gpt-…") on stderr — record the model actually used next to the CLI version
    const seen = cfg.codexModel ?? res.stderr.match(/^model:\s*(\S+)/m)?.[1] ?? null;
    model = seen ? `${version} ${seen}` : version;
    try {
      fs.writeFileSync(logPath, `${res.stderr}\n--- codex ${args.slice(0, 2).join(' ')} | cards ${batch.length} | exit ${res.code ?? 'null'}${res.signal ? ` signal ${res.signal}` : ''}${res.error ? ` | ${res.error}` : ''} | ${secs}s ---\n`);
    } catch {
      /* log file is best-effort */
    }

    let parsed: ParsedTips | null = null;
    let failure: string | null = null;
    if (res.aborted) {
      aborted = true;
      batches.unshift(batch);
      break;
    }
    if (res.code !== 0 || res.error) failure = res.error ?? `codex exited ${res.code}${res.signal ? ` (${res.signal})` : ''}`;
    else if (!fs.existsSync(outPath)) failure = 'codex produced no output file';
    else {
      try {
        parsed = parseCodexOutput(fs.readFileSync(outPath, 'utf8'), batch.map((g) => g.rep.id));
      } catch (e) {
        failure = (e as Error).message;
      }
    }

    if (!parsed) {
      // whole-batch failure → retry once with the batch halved, then record failed
      const retry: TipGroup[] = [];
      for (const g of batch) {
        const n = (failTries.get(g.key) ?? 0) + 1;
        failTries.set(g.key, n);
        if (n >= MAX_BATCH_FAILURES) failGroup(g, failure ?? 'codex failed');
        else retry.push(g);
      }
      if (retry.length) {
        retries++;
        const half = Math.ceil(retry.length / 2);
        const halves = [retry.slice(0, half), retry.slice(half)].filter((h) => h.length);
        batches.unshift(...halves);
      }
      log.warn(`batch ${nnn} (${batch.length} cards) failed after ${secs}s: ${failure} — ${retry.length ? `retrying ${retry.length} cards in ${Math.min(2, retry.length)} halved batch(es)` : 'recorded as failed'} (see ${path.basename(logPath)})`);
    } else {
      const byRep = new Map(batch.map((g) => [g.rep.id, g]));
      const entries = [...parsed.tips].map(([id, tip]) => ({ ids: byRep.get(id)!.ids, tip }));
      const n = writeTips(db, entries, model);
      ctx.afterCommit();
      written += n;
      uniqueOk += entries.length;
      done += entries.reduce((s, e) => s + e.ids.length, 0);
      for (const id of parsed.missing) {
        const g = byRep.get(id)!;
        const tries = (missingTries.get(g.key) ?? 0) + 1;
        missingTries.set(g.key, tries);
        if (tries > MAX_MISSING_RETRIES) failGroup(g, 'no tip returned after retries');
        else requeue.push(g);
      }
      log.info(
        `batch ${nnn}: ${entries.length}/${batch.length} tips (${n} rows) in ${secs}s${parsed.missing.length ? `, missing ${parsed.missing.length} → requeued` : ''}${parsed.unknown.length ? `, ignored unknown ids ${parsed.unknown.slice(0, 5).join(',')}` : ''}`,
      );
    }
    ctx.progress(done, total, `batch ${nnn}: ${written} tips written`);
    if (batches.length || requeue.length) await sleep(PAUSE_MS);
  }

  if (failed.length) writeJsonFile(failedPath, { generated_at: nowIso(), model, failed });
  const remaining = countRemaining(db, {}); // cards with no tip at all (user or codex)
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const parts = [
    `wrote ${written} tips (${uniqueOk} unique cards) in ${invocations} codex call${invocations === 1 ? '' : 's'}${retries ? ` incl. ${retries} halved retr${retries === 1 ? 'y' : 'ies'}` : ''}, ${secs}s`,
    failed.length ? `${failed.length} failed → tips/failed.json` : '',
    aborted ? 'stopped early (aborted / 30-min cap) — run again to continue' : '',
    remaining ? `${remaining} card${remaining === 1 ? '' : 's'} still without tips` : 'all cards have tips',
  ].filter(Boolean);
  const message = parts.join('; ');
  log.info(message);
  return { ok: written, failed: failed.length, message, changed: written > 0 };
}
