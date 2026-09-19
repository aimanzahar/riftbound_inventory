// tcgcsv.com — free daily TCGplayer dump (category 89 = Riftbound). USD.
// groups: https://tcgcsv.com/tcgplayer/89/groups ; per group: /products and /prices. ~0.25 s spacing per the site FAQ.
import type { JobCtx } from '../types.ts';
import type { PriceRow } from './types.ts';
import { fetchJson, sleep } from '../lib/http.ts';
import { all, getSetting, setSetting } from '../../server/db/open.ts';
import type { Finish } from '../../shared/types.ts';

export const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const SPACING_MS = 250;
const GROUPS_CACHE_MS = 24 * 3600 * 1000;

export interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  publishedOn?: string;
}
interface TcgProduct {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}
interface TcgPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  subTypeName: string;
}
interface Results<T> {
  results?: T[];
}

interface SetInfo {
  code: string;
  name: string;
  printed_total: number | null;
}

// 'Number' extended data: '066/298', '007a/298', '299* /298' (signature star, no space in the real value), 'SP3/006', 'R04', 'T01'
// → {prefix, number_int, suffix, total}
export function parseTcgNumber(v: string | undefined | null): { prefix: '' | 'T' | 'R' | 'SP'; number_int: number; suffix: string; total: number | null } | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(?:[A-Z]{2,4}-)?(T|R|SP)?(\d{1,4})\s*([a-z]|\*)?\s*(?:\/\s*(\d{1,4}))?$/i);
  if (!m) return null;
  const prefix = (m[1] ?? '').toUpperCase() as '' | 'T' | 'R' | 'SP';
  const suffix = m[3] === '*' ? 's' : (m[3] ?? '').toLowerCase();
  return { prefix, number_int: Number(m[2]), suffix, total: m[4] ? Number(m[4]) : null };
}

export function finishOf(subTypeName: string | undefined): Finish | null {
  const s = (subTypeName ?? '').toLowerCase();
  if (s === 'normal') return 'normal';
  if (s === 'foil') return 'foil';
  return null;
}

/** Map tcgcsv groups to our sets: abbreviation = set code, else group name contains the set name (longest wins). */
export function matchGroupsToSets(groups: TcgGroup[], sets: SetInfo[]): Array<{ group: TcgGroup; set: SetInfo }> {
  const byCode = new Map(sets.map((s) => [s.code.toUpperCase(), s]));
  const out: Array<{ group: TcgGroup; set: SetInfo }> = [];
  for (const g of groups) {
    const abbr = (g.abbreviation ?? '').toUpperCase();
    let set = abbr ? byCode.get(abbr) : undefined;
    if (!set) {
      const name = (g.name ?? '').toLowerCase();
      const cands = sets.filter((s) => s.name && name.includes(s.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length);
      set = cands[0];
    }
    if (set) out.push({ group: g, set });
  }
  return out;
}

async function loadGroups(ctx: JobCtx, category: number): Promise<TcgGroup[]> {
  const key = 'price_source';
  const cached = getSetting<{ tcgcsv_category?: number; groups?: TcgGroup[]; groups_fetched_at?: string }>(ctx.db, key, { tcgcsv_category: category });
  if (!ctx.flags.force && Array.isArray(cached.groups) && cached.groups.length && cached.groups_fetched_at && Date.now() - Date.parse(cached.groups_fetched_at) < GROUPS_CACHE_MS) {
    return cached.groups;
  }
  const res = await fetchJson<Results<TcgGroup>>(`${TCGCSV_BASE}/${category}/groups`, { signal: ctx.signal });
  const groups = (res.results ?? []).map((g) => ({ groupId: Number(g.groupId), name: String(g.name ?? ''), abbreviation: g.abbreviation ? String(g.abbreviation) : undefined, publishedOn: g.publishedOn }));
  if (!groups.length) throw new Error('tcgcsv: no groups returned');
  setSetting(ctx.db, key, { ...cached, tcgcsv_category: category, groups, groups_fetched_at: new Date().toISOString() });
  return groups;
}

export interface TcgcsvGroupResult {
  group: TcgGroup;
  set: SetInfo;
  rows: PriceRow[];
  matchedProducts: number;
  unmatched: Array<{ productId: number; name: string; number: string }>;
  sealed: number;
  error?: string;
}

/**
 * Streams per-group results to `onGroup` so the caller can commit one transaction per group.
 * Mapping: explicit productId first; collector number only for cards with no assigned market ID.
 */
export async function fetchTcgcsvPrices(ctx: JobCtx, onGroup: (r: TcgcsvGroupResult) => void): Promise<{ groups: number; failedGroups: number }> {
  const { db, log } = ctx;
  const category = Number(getSetting<{ tcgcsv_category?: number }>(db, 'price_source', { tcgcsv_category: 89 }).tcgcsv_category ?? 89);
  const groups = await loadGroups(ctx, category);
  const sets = all<SetInfo>(db, 'SELECT code, name, printed_total FROM sets').map((s) => ({ ...s, printed_total: s.printed_total === null ? null : Number(s.printed_total) }));
  const matched = matchGroupsToSets(groups, sets);
  log.info(`tcgcsv: ${groups.length} groups, ${matched.length} match our sets (${matched.map((m) => `${m.group.abbreviation ?? m.group.name}→${m.set.code}`).join(', ')})`);

  // lookup tables
  const cards = all<{ id: string; set_code: string; number_int: number; number: string; tcgplayer_id: number | null }>(db, 'SELECT id, set_code, number_int, number, tcgplayer_id FROM cards WHERE active = 1');
  const byNumber = new Map<string, string>(); // `${set}|${prefix}|${number_int}|${suffix}` → id
  const byTcg = new Map<number, string[]>();
  for (const c of cards) {
    const m = c.number.match(/^(T|R|SP)?(\d+)([a-z]?)$/);
    if (m && c.tcgplayer_id === null) byNumber.set(`${c.set_code}|${m[1] ?? ''}|${Number(c.number_int)}|${m[3] ?? ''}`, c.id);
    if (c.tcgplayer_id !== null) {
      const k = Number(c.tcgplayer_id);
      const arr = byTcg.get(k);
      if (arr) arr.push(c.id);
      else byTcg.set(k, [c.id]);
    }
  }

  let failedGroups = 0;
  let i = 0;
  for (const { group, set } of matched) {
    if (ctx.signal.aborted) break;
    ctx.progress(i++, matched.length, `tcgcsv ${group.abbreviation ?? group.name}`);
    const result: TcgcsvGroupResult = { group, set, rows: [], matchedProducts: 0, unmatched: [], sealed: 0 };
    try {
      const prodRes = await fetchJson<Results<TcgProduct>>(`${TCGCSV_BASE}/${category}/${group.groupId}/products`, { signal: ctx.signal, timeoutMs: 60000 });
      await sleep(SPACING_MS);
      const priceRes = await fetchJson<Results<TcgPrice>>(`${TCGCSV_BASE}/${category}/${group.groupId}/prices`, { signal: ctx.signal, timeoutMs: 60000 });
      await sleep(SPACING_MS);
      const products = new Map<number, { name: string; number: string | null }>();
      for (const p of prodRes.results ?? []) {
        const num = (p.extendedData ?? []).find((e) => e.name === 'Number')?.value ?? null;
        products.set(Number(p.productId), { name: String(p.name ?? ''), number: num });
        if (!num) result.sealed++;
      }
      // Promos can share printed numbers with regular cards: market IDs identify the printing.
      const resolved = new Map<number, { ids: string[]; exact: boolean }>();
      const productsMatched = new Set<number>();
      for (const [productId, p] of products) {
        const parsed = parseTcgNumber(p.number);
        let ids: string[] = byTcg.get(productId) ?? [];
        const exact = ids.length > 0;
        // tokens/runes/specials ('T01', 'R04', 'SP3/006') carry their own numbering → no printed-total check for them
        if (!exact && parsed && (parsed.prefix !== '' || parsed.total === null || set.printed_total === null || parsed.total === set.printed_total)) {
          const id = byNumber.get(`${set.code}|${parsed.prefix}|${parsed.number_int}|${parsed.suffix}`);
          if (id) {
            ids = [id];
          }
        }
        if (ids.length) {
          resolved.set(productId, { ids, exact });
          productsMatched.add(productId);
        } else if (p.number) result.unmatched.push({ productId, name: p.name, number: p.number });
      }
      // Explicit market matches override collector-number fallback matches.
      const rows = new Map<string, { row: PriceRow; exact: boolean }>();
      for (const pr of priceRes.results ?? []) {
        const r = resolved.get(Number(pr.productId));
        if (!r) continue;
        const finish = finishOf(pr.subTypeName);
        if (!finish) continue;
        const market = numOrNull(pr.marketPrice);
        const low = numOrNull(pr.lowPrice);
        const mid = numOrNull(pr.midPrice);
        const high = numOrNull(pr.highPrice);
        if (market === null && low === null && mid === null && high === null) continue;
        for (const id of r.ids) {
          const key = `${id}:${finish}`;
          const prev = rows.get(key);
          if (prev && prev.exact && !r.exact) continue;
          rows.set(key, { exact: r.exact, row: { card_id: id, finish, usd_market: market, usd_low: low, usd_mid: mid, usd_high: high, source: 'tcgplayer', source_ref: String(pr.productId) } });
        }
      }
      result.rows = [...rows.values()].map((x) => x.row);
      result.matchedProducts = productsMatched.size;
    } catch (e) {
      result.error = (e as Error).message;
      failedGroups++;
      log.warn(`tcgcsv group ${group.groupId} (${group.name}) failed: ${result.error}`);
    }
    onGroup(result);
  }
  return { groups: matched.length, failedGroups };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
