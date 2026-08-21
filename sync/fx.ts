// Job: fx — USD→MYR daily rate. frankfurter → open.er-api → settings.fx_manual_rate; writes fx_rates + an 'fx' change row
// only when the rate moved (>0.0001) or the stored one is older than 24 h. `--rate N` bypasses the network (tests).
import type { JobCtx, JobResult } from './types.ts';
import { fetchJson } from './lib/http.ts';
import { getSetting, nowIso, one, run as sqlRun, today } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';
import type { FxPayload } from '../shared/types.ts';

export const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=MYR';
export const ERAPI_URL = 'https://open.er-api.com/v6/latest/USD';
const MIN_RATE = 0.5;
const MAX_RATE = 20;
const STALE_MS = 24 * 3600 * 1000;

export function validRate(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > MIN_RATE && n < MAX_RATE ? n : null;
}

interface FxRow {
  rate: number;
  day: string;
  source: string;
  fetched_at: string;
}

/** Upsert today's rate; returns whether a change row was written. Exported for tests. */
export function storeRate(ctx: Pick<JobCtx, 'db'>, rate: number, source: string, day = today()): { changed: boolean; prev: FxRow | null } {
  const { db } = ctx;
  return db.tx(() => {
    const prev = one<FxRow>(db, `SELECT rate, day, source, fetched_at FROM fx_rates WHERE base='USD' AND quote='MYR' ORDER BY day DESC, fetched_at DESC LIMIT 1`) ?? null;
    const fetched_at = nowIso();
    sqlRun(
      db,
      `INSERT INTO fx_rates(base, quote, day, rate, source, fetched_at) VALUES ('USD','MYR',?,?,?,?)
       ON CONFLICT(base, quote, day) DO UPDATE SET rate=excluded.rate, source=excluded.source, fetched_at=excluded.fetched_at`,
      day,
      rate,
      source,
      fetched_at,
    );
    const moved = !prev || Math.abs(Number(prev.rate) - rate) > 0.0001;
    const stale = !prev || Date.now() - Date.parse(prev.fetched_at) > STALE_MS;
    const changed = moved || stale;
    if (changed) {
      const payload: FxPayload = { rate, day, source };
      insertChange(db, { kind: 'fx', payload });
    }
    return { changed, prev };
  });
}

async function fromFrankfurter(ctx: JobCtx): Promise<number> {
  const j = await fetchJson<{ rates?: { MYR?: number } }>(FRANKFURTER_URL, { signal: ctx.signal, timeoutMs: 15000, retries: 1 });
  const r = validRate(j?.rates?.MYR);
  if (r === null) throw new Error(`frankfurter: invalid rate ${JSON.stringify(j?.rates)}`);
  return r;
}
async function fromErApi(ctx: JobCtx): Promise<number> {
  const j = await fetchJson<{ result?: string; rates?: { MYR?: number } }>(ERAPI_URL, { signal: ctx.signal, timeoutMs: 15000, retries: 1 });
  const r = validRate(j?.rates?.MYR);
  if (r === null) throw new Error(`open.er-api: invalid rate ${JSON.stringify(j?.rates?.MYR)} (${j?.result ?? 'no result'})`);
  return r;
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, log } = ctx;
  const errors: string[] = [];
  let rate: number | null = null;
  let source = '';

  const flagRate = validRate(ctx.flags.rate);
  if (ctx.flags.rate !== undefined && flagRate === null) return { ok: 0, failed: 1, message: `error: --rate must be between ${MIN_RATE} and ${MAX_RATE}` };
  if (flagRate !== null) {
    rate = flagRate;
    source = 'manual';
  }
  if (rate === null) {
    for (const [name, fn] of [
      ['frankfurter', fromFrankfurter],
      ['open.er-api', fromErApi],
    ] as const) {
      try {
        rate = await fn(ctx);
        source = name;
        break;
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message}`);
        log.warn(`${name} failed: ${(e as Error).message}`);
      }
    }
  }
  if (rate === null) {
    const manual = validRate(getSetting<number | null>(db, 'fx_manual_rate', null));
    if (manual !== null) {
      rate = manual;
      source = 'manual';
    }
  }
  if (rate === null) {
    return { ok: 0, failed: 1, message: `error: all FX sources failed (${errors.join('; ')}) and no fx_manual_rate set`, changed: false };
  }

  const { changed, prev } = storeRate(ctx, rate, source);
  const message = `USD→MYR ${rate.toFixed(4)} (${source})${prev ? `, previous ${Number(prev.rate).toFixed(4)} on ${prev.day}` : ''}${changed ? '' : ' · unchanged'}${errors.length ? ` · fallbacks: ${errors.join('; ')}` : ''}`;
  log.info(message);
  return { ok: 1, failed: 0, message, changed };
}
