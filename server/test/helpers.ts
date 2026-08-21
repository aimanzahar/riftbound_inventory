// Test helpers (node:test + node:assert only): spawn an isolated server on an ephemeral port with its own
// DATA_DIR (scheduler off), seed a tiny catalog the API will accept, and talk to it over HTTP / SSE.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, run, nowIso } from '../db/open.ts';
import { migrate } from '../db/migrate.ts';
import type { Finish, ProductKind } from '../../shared/types.ts';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'server', 'db', 'migrations');

/** X-Device-Id used by the test client. */
export const DEVICE_ID = 'test-device-0001';
export const opId = (): string => randomUUID();
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
// Seed catalog: one set, ~14 printings (incl. an alt-art variant and two Runes), two products.
// Names/ids mirror real Origins cards where known; the API only accepts ids that exist in `cards`.
// ---------------------------------------------------------------------------------------------
export interface SeedCard {
  id: string;
  number: string;
  number_int: number;
  name: string;
  type: string;
  supertype?: string | null;
  domains?: string[];
  rarity?: string | null;
  variant_of?: string | null;
  variant_kind?: string | null;
}

export const SEED_SET = { code: 'OGN', name: 'Origins', release_date: '2025-10-31', printed_total: 298 } as const;

export const SEED_CARDS: SeedCard[] = [
  { id: 'OGN-001', number: '001', number_int: 1, name: 'Blazing Scorcher', type: 'Unit', domains: ['fury'], rarity: 'Common' },
  { id: 'OGN-002', number: '002', number_int: 2, name: 'Brazen Buccaneer', type: 'Unit', domains: ['fury'], rarity: 'Common' },
  { id: 'OGN-003', number: '003', number_int: 3, name: 'Chemtech Enforcer', type: 'Unit', domains: ['fury'], rarity: 'Common' },
  { id: 'OGN-006', number: '006', number_int: 6, name: 'Flame Chompers', type: 'Unit', domains: ['fury'], rarity: 'Common' },
  { id: 'OGN-007', number: '007', number_int: 7, name: 'Fury Rune', type: 'Rune', supertype: 'Basic', domains: ['fury'], rarity: 'Common' },
  { id: 'OGN-008', number: '008', number_int: 8, name: 'Get Excited!', type: 'Spell', domains: ['fury'], rarity: 'Uncommon' },
  { id: 'OGN-011', number: '011', number_int: 11, name: 'Magma Wurm', type: 'Unit', domains: ['fury'], rarity: 'Rare' },
  { id: 'OGN-013', number: '013', number_int: 13, name: 'Pouty Poro', type: 'Unit', domains: ['fury'], rarity: 'Common' },
  { id: 'OGN-030', number: '030', number_int: 30, name: 'Jinx, Demolitionist', type: 'Unit', supertype: 'Champion', domains: ['fury'], rarity: 'Rare' },
  { id: 'OGN-036', number: '036', number_int: 36, name: 'Vi, Destructive', type: 'Unit', supertype: 'Champion', domains: ['fury'], rarity: 'Epic' },
  { id: 'OGN-036a', number: '036a', number_int: 36, name: 'Vi, Destructive', type: 'Unit', supertype: 'Champion', domains: ['fury'], rarity: 'Epic', variant_of: 'OGN-036', variant_kind: 'alt_art' },
  { id: 'OGN-043', number: '043', number_int: 43, name: 'Charm', type: 'Spell', domains: ['calm'], rarity: 'Common' },
  { id: 'OGN-166', number: '166', number_int: 166, name: 'Chaos Rune', type: 'Rune', supertype: 'Basic', domains: ['chaos'], rarity: 'Common' },
  { id: 'OGN-251', number: '251', number_int: 251, name: 'Jinx, Loose Cannon', type: 'Legend', domains: ['fury', 'chaos'], rarity: 'Rare' },
];

export interface SeedProduct {
  id: string;
  name: string;
  kind: ProductKind;
  fixed_contents: number;
  contents: { card_id: string; finish: Finish; qty: number }[];
}

/** Fixed-list product; its cards are deliberately disjoint from the ones the inventory tests touch. */
export const SEED_PRODUCT: SeedProduct = {
  id: 'ogn-champion-deck-test',
  name: 'Jinx, Loose Cannon Champion Deck (test)',
  kind: 'champion_deck',
  fixed_contents: 1,
  contents: [
    { card_id: 'OGN-251', finish: 'normal', qty: 1 },
    { card_id: 'OGN-030', finish: 'normal', qty: 1 },
    { card_id: 'OGN-036a', finish: 'normal', qty: 1 },
    { card_id: 'OGN-006', finish: 'normal', qty: 3 },
    { card_id: 'OGN-008', finish: 'normal', qty: 2 },
    { card_id: 'OGN-007', finish: 'normal', qty: 6 },
    { card_id: 'OGN-166', finish: 'normal', qty: 6 },
  ],
};
export const SEED_PRODUCT_COPIES = SEED_PRODUCT.contents.reduce((a, c) => a + c.qty, 0); // 20

/** Product without a fixed card list (booster) — not purchasable via /buy. */
export const SEED_BOOSTER: SeedProduct = { id: 'ogn-booster-pack-test', name: 'Origins Booster Pack (test)', kind: 'booster_pack', fixed_contents: 0, contents: [] };

/** Create/migrate <dataDir>/app.db and insert the seed catalog. Safe to call before the server starts. */
export function seedCards(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'app.db'));
  try {
    migrate(db, MIGRATIONS_DIR);
    db.tx(() => {
      const ts = nowIso();
      run(
        db,
        `INSERT OR IGNORE INTO sets(code, name, release_date, card_count, printed_total, sort_order, updated_at) VALUES (?,?,?,?,?,?,?)`,
        SEED_SET.code,
        SEED_SET.name,
        SEED_SET.release_date,
        SEED_CARDS.length,
        SEED_SET.printed_total,
        1,
        ts,
      );
      for (const c of SEED_CARDS) {
        run(
          db,
          `INSERT OR IGNORE INTO cards(id, set_code, number, number_int, riot_id, public_code, name, type, supertype, domains, rarity, tags, orientation,
                                        image_url, variant_of, variant_kind, has_foil, has_normal, active, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.id,
          SEED_SET.code,
          c.number,
          c.number_int,
          `${c.id.toLowerCase()}-${SEED_SET.printed_total}`,
          `${c.id}/${SEED_SET.printed_total}`,
          c.name,
          c.type,
          c.supertype ?? null,
          JSON.stringify(c.domains ?? []),
          c.rarity ?? null,
          '[]',
          'portrait',
          null,
          c.variant_of ?? null,
          c.variant_kind ?? null,
          1,
          1,
          1,
          ts,
        );
      }
      for (const p of [SEED_PRODUCT, SEED_BOOSTER]) {
        run(
          db,
          `INSERT OR IGNORE INTO products(id, name, set_code, kind, release_date, msrp_usd, fixed_contents, active, updated_at) VALUES (?,?,?,?,?,?,?,1,?)`,
          p.id,
          p.name,
          SEED_SET.code,
          p.kind,
          SEED_SET.release_date,
          19.99,
          p.fixed_contents,
          ts,
        );
        for (const pc of p.contents) run(db, `INSERT OR IGNORE INTO product_contents(product_id, card_id, finish, qty) VALUES (?,?,?,?)`, p.id, pc.card_id, pc.finish, pc.qty);
      }
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Server process
// ---------------------------------------------------------------------------------------------
export interface TestServer {
  baseUrl: string;
  port: number;
  dataDir: string;
  child: ChildProcess;
  /** stderr captured so far (useful in failure messages) */
  stderr(): string;
  stop(): Promise<void>;
}

/**
 * Spawn `node server/index.ts` with PORT=0, HOST=127.0.0.1, DATA_DIR=<fresh temp dir>, NO_SCHEDULER=1,
 * wait for the "Local:  http://localhost:<port>" line and return the base URL. Seeds the catalog first unless seed:false.
 */
export async function startServer(opts: { dataDir?: string; seed?: boolean; timeoutMs?: number } = {}): Promise<TestServer> {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'riftbound-test-'));
  if (opts.seed !== false) seedCards(dataDir);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, NO_SCHEDULER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (d: string) => {
    err += d;
  });

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start within ${timeoutMs} ms\n--- stdout ---\n${out}\n--- stderr ---\n${err}`)), timeoutMs);
    child.stdout!.on('data', (d: string) => {
      out += d;
      const m = out.match(/Local:\s+http:\/\/localhost:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}, signal ${signal})\n--- stdout ---\n${out}\n--- stderr ---\n${err}`));
    });
    child.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    child,
    stderr: () => err,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((r) => child.once('exit', () => r()));
        child.kill();
        await Promise.race([exited, sleep(3000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch {
        /* temp dir left behind; not fatal */
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------------------------
export interface ApiResponse<T> {
  status: number;
  headers: Headers;
  body: T;
  text: string;
}

export interface ApiClient {
  req<T = unknown>(method: string, p: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse<T>>;
  get<T = unknown>(p: string, headers?: Record<string, string>): Promise<ApiResponse<T>>;
  post<T = unknown>(p: string, body?: unknown): Promise<ApiResponse<T>>;
  put<T = unknown>(p: string, body?: unknown): Promise<ApiResponse<T>>;
}

/** Minimal JSON client that always sends X-Device-Id. `body` is the parsed JSON (null if not JSON). */
export function makeClient(baseUrl: string, deviceId: string = DEVICE_ID): ApiClient {
  async function req<T = unknown>(method: string, p: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResponse<T>> {
    const res = await fetch(baseUrl + p, {
      method,
      headers: { 'X-Device-Id': deviceId, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, body: json as T, text };
  }
  return {
    req,
    get: (p, headers) => req('GET', p, undefined, headers),
    post: (p, body) => req('POST', p, body),
    put: (p, body) => req('PUT', p, body),
  };
}

// ---------------------------------------------------------------------------------------------
// SSE client (fetch + body reader)
// ---------------------------------------------------------------------------------------------
export interface SseEvent {
  event: string;
  data: string;
  id?: string;
  /** wall-clock ms when the event was parsed */
  at: number;
  json<T = unknown>(): T;
}

export interface SseClient {
  /** every event received so far (comments / retry lines are not events) */
  events: SseEvent[];
  /** resolve with the first event (past or future) matching `pred`; reject after timeoutMs */
  waitFor(pred: (e: SseEvent) => boolean, timeoutMs?: number): Promise<SseEvent>;
  close(): void;
}

function parseSseBlock(block: string): SseEvent | null {
  let event = 'message';
  let id: string | undefined;
  const data: string[] = [];
  let sawField = false;
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') {
      event = value;
      sawField = true;
    } else if (field === 'data') {
      data.push(value);
      sawField = true;
    } else if (field === 'id') id = value;
    // retry: ignored
  }
  if (!sawField) return null;
  const joined = data.join('\n');
  return { event, data: joined, id, at: Date.now(), json: <T>() => JSON.parse(joined) as T };
}

export async function openSse(url: string): Promise<SseClient> {
  const ac = new AbortController();
  const res = await fetch(url, { signal: ac.signal, headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`SSE connect failed: HTTP ${res.status}`);
  const events: SseEvent[] = [];
  const waiters: { pred: (e: SseEvent) => boolean; resolve: (e: SseEvent) => void }[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = parseSseBlock(block);
          if (!ev) continue;
          events.push(ev);
          for (const w of [...waiters]) {
            if (w.pred(ev)) {
              waiters.splice(waiters.indexOf(w), 1);
              w.resolve(ev);
            }
          }
        }
      }
    } catch {
      /* aborted / closed */
    }
  })();
  return {
    events,
    waitFor(pred, timeoutMs = 1500) {
      const found = events.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise<SseEvent>((resolve, reject) => {
        const w = {
          pred,
          resolve: (e: SseEvent) => {
            clearTimeout(t);
            resolve(e);
          },
        };
        const t = setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`timed out after ${timeoutMs} ms waiting for SSE event (received: ${events.map((e) => e.event).join(', ') || 'none'})`));
        }, timeoutMs);
        waiters.push(w);
      });
    },
    close() {
      ac.abort();
    },
  };
}
