// DotGG card index — used only for the TCGplayer-id / finish / banned join and as a price fallback.
// `https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed` → { names: string[], data: unknown[][] }
import type { JobCtx } from '../types.ts';
import type { CardJoinRow } from './types.ts';
import { fetchJson } from '../lib/http.ts';
import { normalizeCommunityId } from '../../shared/ids.ts';

export const DOTGG_CARDS_URL = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';

export interface DotggRow extends CardJoinRow {
  dotgg_id: string; // raw id as dotgg has it ('OGN-303-STAR')
  name: string | null;
}

interface Indexed {
  names?: string[];
  data?: unknown[][];
}

function flag(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return null;
}
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function firstInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse the indexed payload into rows keyed by OUR id (promos '-P' and unparsable ids are dropped). */
export function parseDotggIndexed(payload: Indexed): DotggRow[] {
  const names = Array.isArray(payload.names) ? payload.names : [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  if (!names.length || !data.length) throw new Error('dotgg: unexpected payload (no names/data)');
  const col = (n: string) => names.indexOf(n);
  const iId = col('id');
  const iName = col('name');
  const iMarket = col('marketIds');
  const iPrice = col('price');
  const iFoil = col('foilPrice');
  const iHasN = col('hasNormal');
  const iHasF = col('hasFoil');
  const iBanned = col('banned');
  const iFlavor = col('flavor');
  if (iId < 0) throw new Error('dotgg: payload has no id column');
  const out: DotggRow[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const raw = String(row[iId] ?? '');
    if (!raw) continue;
    const id = normalizeCommunityId(raw);
    if (!id) continue;
    const flavorRaw = iFlavor >= 0 ? row[iFlavor] : null;
    out.push({
      id,
      dotgg_id: raw,
      name: iName >= 0 && row[iName] ? String(row[iName]) : null,
      tcgplayer_id: iMarket >= 0 ? firstInt(row[iMarket]) : null,
      has_normal: iHasN >= 0 ? flag(row[iHasN]) : null,
      has_foil: iHasF >= 0 ? flag(row[iHasF]) : null,
      banned: iBanned >= 0 ? flag(row[iBanned]) : null,
      flavor: typeof flavorRaw === 'string' && flavorRaw.trim() ? flavorRaw.trim() : null,
      price: iPrice >= 0 ? money(row[iPrice]) : null,
      foil_price: iFoil >= 0 ? money(row[iFoil]) : null,
    });
  }
  return out;
}

/** Fetch + parse. Throws on network/shape errors (callers decide whether that is fatal). */
export async function fetchDotggCards(ctx: Pick<JobCtx, 'log' | 'signal'>): Promise<DotggRow[]> {
  const payload = await fetchJson<Indexed>(DOTGG_CARDS_URL, { signal: ctx.signal, timeoutMs: 60000 });
  const rows = parseDotggIndexed(payload);
  ctx.log.info(`dotgg: ${rows.length} rows (${rows.filter((r) => r.tcgplayer_id).length} with tcgplayer ids)`);
  return rows;
}

/** Collapse rows to one per our id (prefer the row that carries a tcgplayer id / prices). */
export function indexJoinRows(rows: CardJoinRow[]): Map<string, CardJoinRow> {
  const map = new Map<string, CardJoinRow>();
  for (const r of rows) {
    const prev = map.get(r.id);
    if (!prev) {
      map.set(r.id, r);
      continue;
    }
    const score = (x: CardJoinRow) => (x.tcgplayer_id ? 2 : 0) + (x.price || x.foil_price ? 1 : 0);
    if (score(r) > score(prev)) map.set(r.id, { ...prev, ...r, flavor: r.flavor ?? prev.flavor });
    else if (!prev.flavor && r.flavor) map.set(r.id, { ...prev, flavor: r.flavor });
  }
  return map;
}
