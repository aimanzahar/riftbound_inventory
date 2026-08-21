// Local-file price source (fixtures / offline): { prices: [{card_id, finish, usd_market, usd_low?, usd_mid?, usd_high?, source?, source_ref?}] } or a bare array.
import fs from 'node:fs';
import type { JobCtx } from '../types.ts';
import type { PriceRow } from './types.ts';
import { readJsonFile } from '../lib/files.ts';
import { resolveLocalFile } from './cards.localjson.ts';
import { normalizeCommunityId } from '../../shared/ids.ts';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadLocalPrices(ctx: Pick<JobCtx, 'cfg' | 'flags' | 'log'>): Promise<PriceRow[]> {
  const file = resolveLocalFile(ctx, 'prices.json');
  if (!fs.existsSync(file)) throw new Error(`local price file not found: ${file}`);
  const doc = readJsonFile<unknown>(file);
  const list = Array.isArray(doc) ? doc : Array.isArray((doc as { prices?: unknown[] }).prices) ? (doc as { prices: unknown[] }).prices : [];
  const out: PriceRow[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const id = typeof r.card_id === 'string' ? normalizeCommunityId(r.card_id) ?? r.card_id.toUpperCase() : null;
    if (!id) continue;
    const finish = r.finish === 'foil' ? 'foil' : r.finish === 'normal' || r.finish === undefined ? 'normal' : null;
    if (!finish) continue;
    const row: PriceRow = {
      card_id: id,
      finish,
      usd_market: num(r.usd_market ?? r.market),
      usd_low: num(r.usd_low ?? r.low),
      usd_mid: num(r.usd_mid ?? r.mid),
      usd_high: num(r.usd_high ?? r.high),
      source: typeof r.source === 'string' && r.source ? r.source : 'localjson',
      source_ref: r.source_ref === undefined || r.source_ref === null ? null : String(r.source_ref),
    };
    if (row.usd_market === null && row.usd_low === null && row.usd_mid === null && row.usd_high === null) continue;
    out.push(row);
  }
  ctx.log.info(`localjson prices: ${out.length} rows from ${file}`);
  return out;
}
