// Local-file card source (fixtures / offline). Accepts either
//   { sets: SourceSet[], cards: SourceCard[], join?: CardJoinRow[] }   (our simplified shape), or
//   { data: RiotCardItem[], sets?: RiotSetItem[] }                     (a saved Riot gallery dump).
import fs from 'node:fs';
import path from 'node:path';
import type { JobCtx } from '../types.ts';
import type { CardJoinRow, CardSourceResult, SourceCard, SourceSet } from './types.ts';
import { readJsonFile } from '../lib/files.ts';
import { KNOWN_RELEASE_DATES, mapRiotItem, mapRiotSets, htmlToText, type RiotCardItem } from './cards.riot.ts';
import { communityCardParts, fromRiotId, normalizeCommunityId } from '../../shared/ids.ts';

interface LocalFile {
  sets?: unknown[];
  cards?: unknown[];
  join?: unknown[];
  data?: unknown[];
}

export function resolveLocalFile(ctx: Pick<JobCtx, 'cfg' | 'flags'>, defaultName: string): string {
  const f = ctx.flags.file;
  if (typeof f === 'string' && f.trim()) return path.resolve(f);
  return path.join(ctx.cfg.dataDir, 'seed', defaultName);
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/** Normalise a loosely-typed card object (our shape) into a SourceCard; fills number/number_int/suffix from the id when missing. */
export function coerceSourceCard(raw: Record<string, unknown>): SourceCard | null {
  const idRaw = str(raw.id) ?? (typeof raw.riot_id === 'string' ? fromRiotId(raw.riot_id)?.id ?? null : null);
  if (!idRaw || !raw.name) return null;
  const parts = communityCardParts(idRaw);
  if (!parts) return null;
  const { id } = parts;
  const set_code = str(raw.set_code) ?? parts.set;
  const number = str(raw.number) ?? parts.number;
  const number_int = num(raw.number_int) ?? parts.number_int;
  const suffix = str(raw.suffix) ?? parts.suffix;
  const rules_html = str(raw.rules_html);
  return {
    id,
    set_code,
    number,
    number_int,
    suffix,
    riot_id: str(raw.riot_id),
    public_code: str(raw.public_code),
    name: String(raw.name),
    canonical_name: str(raw.canonical_name) ?? undefined,
    printing_kind: str(raw.printing_kind),
    type: str(raw.type),
    supertype: str(raw.supertype),
    domains: arr(raw.domains).map((d) => d.toLowerCase()),
    energy: num(raw.energy),
    might: num(raw.might),
    power: num(raw.power),
    rarity: str(raw.rarity),
    rules_text: str(raw.rules_text) ?? htmlToText(rules_html),
    rules_html,
    flavor: str(raw.flavor),
    artist: str(raw.artist),
    tags: arr(raw.tags),
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    image_url: str(raw.image_url),
  };
}

export function coerceJoinRow(raw: Record<string, unknown>): CardJoinRow | null {
  const idRaw = str(raw.id);
  if (!idRaw) return null;
  const id = normalizeCommunityId(idRaw);
  if (!id) return null;
  const b = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(Number(v)) || v === true);
  return {
    id,
    tcgplayer_id: num(raw.tcgplayer_id),
    has_normal: b(raw.has_normal),
    has_foil: b(raw.has_foil),
    banned: b(raw.banned),
    flavor: str(raw.flavor),
    price: num(raw.price),
    foil_price: num(raw.foil_price),
  };
}

export async function loadLocalCards(ctx: Pick<JobCtx, 'cfg' | 'flags' | 'log'>): Promise<CardSourceResult> {
  const file = resolveLocalFile(ctx, 'cards.json');
  if (!fs.existsSync(file)) throw new Error(`local card file not found: ${file}`);
  const doc = readJsonFile<LocalFile | unknown[]>(file);
  const body: LocalFile = Array.isArray(doc) ? { cards: doc } : doc;
  let cards: SourceCard[] = [];
  let sets: SourceSet[] = [];
  if (Array.isArray(body.data)) {
    // Riot dump
    for (const it of body.data) {
      const c = mapRiotItem(it as RiotCardItem);
      if (c) cards.push(c);
    }
    const perSet = new Map<string, number>();
    for (const c of cards) perSet.set(c.set_code, (perSet.get(c.set_code) ?? 0) + 1);
    sets = mapRiotSets(Array.isArray(body.sets) ? (body.sets as { id: string; name: string; collectorNumberMax?: number }[]) : [], perSet);
  } else {
    for (const raw of body.cards ?? []) {
      const c = coerceSourceCard(raw as Record<string, unknown>);
      if (c) cards.push(c);
    }
    for (const raw of body.sets ?? []) {
      const s = raw as Record<string, unknown>;
      if (!s.code) continue;
      sets.push({
        code: String(s.code).toUpperCase(),
        name: String(s.name ?? s.code),
        printed_total: num(s.printed_total),
        release_date: str(s.release_date) ?? KNOWN_RELEASE_DATES[String(s.code).toUpperCase()] ?? null,
      });
    }
    for (const c of cards) {
      if (!sets.some((s) => s.code === c.set_code)) sets.push({ code: c.set_code, name: c.set_code, printed_total: null, release_date: KNOWN_RELEASE_DATES[c.set_code] ?? null });
    }
  }
  const join = Array.isArray(body.join) ? body.join.map((r) => coerceJoinRow(r as Record<string, unknown>)).filter((r): r is CardJoinRow => Boolean(r)) : undefined;
  ctx.log.info(`localjson: ${cards.length} cards, ${sets.length} sets${join ? `, ${join.length} join rows` : ''} from ${file}`);
  return { source: 'localjson', sets, cards, join, note: `localjson: ${path.basename(file)}` };
}
