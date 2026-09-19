// tcgcsv.com — free daily TCGplayer dump (category 89 = Riftbound). USD.
// groups: https://tcgcsv.com/tcgplayer/89/groups ; per group: /products and /prices. ~0.25 s spacing per the site FAQ.
import type { JobCtx } from '../types.ts';
import type { PriceRow } from './types.ts';
import { fetchJson, sleep } from '../lib/http.ts';
import { all, getSetting, setSetting } from '../../server/db/open.ts';
import { applyMarketDecisions, rejectedMarket, type MarketDecision } from '../market.ts';
import type { Finish } from '../../shared/types.ts';

export const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';
const SPACING_MS = 250;

export interface TcgGroup {
  groupId: number;
  name: string;
  abbreviation?: string;
  publishedOn?: string;
}
export interface TcgProduct {
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

export interface SetInfo {
  code: string;
  name: string;
  printed_total: number | null;
}

// 'Number' extended data: '066/298', '007a/298', '299* /298' (signature star, no space in the real value), 'SP3/006', 'R04', 'T01'
// → {prefix, number_int, suffix, total}
export function parseTcgNumber(v: string | undefined | null): { prefix: '' | 'T' | 'R' | 'SP'; number_int: number; suffix: string; total: number | null } | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(?:[A-Z][A-Z0-9]{1,5}[-\s]+)?(T|R|SP)?(\d{1,4})\s*([a-z]|\*)?\s*(?:\/\s*(\d{1,4}))?$/i);
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
  const res = await fetchJson<Results<TcgGroup>>(`${TCGCSV_BASE}/${category}/groups`, { signal: ctx.signal });
  const groups = (res.results ?? []).map((g) => ({ groupId: Number(g.groupId), name: String(g.name ?? ''), abbreviation: g.abbreviation ? String(g.abbreviation) : undefined, publishedOn: g.publishedOn }));
  if (!groups.length) throw new Error('tcgcsv: no groups returned');
  setSetting(ctx.db, key, { ...cached, tcgcsv_category: category, groups, groups_fetched_at: new Date().toISOString() });
  return groups;
}

export interface MarketCard {
  id: string;
  set_code: string;
  number: string;
  name: string;
  tcgplayer_id: number | null;
  variant_kind: string | null;
}

function numberOf(p: TcgProduct): string | null {
  return p.extendedData?.find((e) => e.name === 'Number')?.value ?? null;
}
function nameKey(s: string): string {
  return s.replace(/\([^)]*\)/g, '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function championAward(name: string): boolean {
  return /\(champion\)|\([^)]*(?:skirmish|qualifier|regional)[^)]*\bchampion\b|\([^)]*\bchampion promo\b/i.test(name);
}
function promoGroup(group: TcgGroup, p: TcgProduct): boolean {
  return /\bpromo(?:tional)?\b|organized play|\bjudge\b|nexus night|pre.?rift/i.test(`${group.name} ${p.name}`) || p.extendedData?.some((e) => e.name === 'Rarity' && /^promo$/i.test(e.value)) === true;
}

/** A contradiction rejects an ID; incomplete metadata alone never invalidates stored prices. */
export function marketConflict(c: MarketCard, p: TcgProduct, group: TcgGroup, set: SetInfo | undefined, sets: SetInfo[]): string | null {
  const printedCode = numberOf(p)?.trim().match(/^([A-Z][A-Z0-9]{1,5})[-\s]+(?=(?:T|R|SP)?\d)/i)?.[1].toUpperCase();
  if (printedCode && printedCode !== c.set_code) return 'printed set code differs';
  const parsed = parseTcgNumber(numberOf(p));
  const own = parseTcgNumber(c.number.replace(/-P(?:\d|$|-).*$/, '').replace(/-OVERSIZED$/, ''));
  if (parsed && own && (parsed.prefix !== own.prefix || parsed.number_int !== own.number_int || (parsed.suffix !== own.suffix && !(promoGroup(group, p) && parsed.suffix === '' && c.variant_kind === 'promo')))) return 'collector number or artwork differs';
  if (set && set.code !== c.set_code && !(c.variant_kind === 'oversized' && /oversized/i.test(p.name))) return 'set differs';
  const total = sets.find((s) => s.code === c.set_code)?.printed_total;
  if (parsed && !parsed.prefix && parsed.total !== null && total != null && parsed.total !== total) return 'printed total differs';
  // Named regular expansion groups must not supply a promo's regular-art price.
  if (set?.printed_total != null && c.variant_kind === 'promo' && !promoGroup(group, p)) return 'regular product assigned to promo';
  if (promoGroup(group, p) && c.variant_kind !== 'promo') return 'promo product assigned to regular printing';
  if (c.variant_kind === 'promo' && promoGroup(group, p) && championAward(c.name) !== championAward(p.name)) return 'promo award differs';
  if (/oversized/i.test(p.name) !== /oversized/i.test(c.variant_kind ?? '') && /oversized/i.test(`${p.name} ${c.variant_kind}`)) return 'oversized printing differs';
  return null;
}

export interface TcgcsvGroupResult {
  group: TcgGroup;
  set?: SetInfo;
  rows: PriceRow[];
  matchedProducts: number;
  unmatched: Array<{ productId: number; name: string; number: string }>;
  sealed: number;
  ambiguous: number;
  error?: string;
}

/** Discover every group; resolve globally before writing so feed/group order cannot pick a printing. */
export async function fetchTcgcsvPrices(ctx: JobCtx, onGroup: (r: TcgcsvGroupResult) => void): Promise<{ groups: number; failedGroups: number; changed: boolean; resolved: number; rejected: number }> {
  const { db, log } = ctx;
  const category = Number(getSetting<{ tcgcsv_category?: number }>(db, 'price_source', { tcgcsv_category: 89 }).tcgcsv_category ?? 89);
  const groups = await loadGroups(ctx, category);
  const sets = all<SetInfo>(db, 'SELECT code, name, printed_total FROM sets');
  const groupSets = new Map(matchGroupsToSets(groups, sets).map((m) => [m.group.groupId, m.set]));
  const cards = all<MarketCard>(db, 'SELECT id, set_code, number, name, tcgplayer_id, variant_kind FROM cards WHERE active=1');
  const batches: Array<{ result: TcgcsvGroupResult; products: TcgProduct[]; prices: TcgPrice[] }> = [];
  let failedGroups = 0;
  for (const group of groups) {
    ctx.signal.throwIfAborted();
    ctx.progress(batches.length, groups.length, `tcgcsv ${group.abbreviation ?? group.name}`);
    const batch = { result: { group, set: groupSets.get(group.groupId), rows: [], matchedProducts: 0, unmatched: [], sealed: 0, ambiguous: 0 } as TcgcsvGroupResult, products: [] as TcgProduct[], prices: [] as TcgPrice[] };
    try {
      const products = await fetchJson<Results<TcgProduct>>(`${TCGCSV_BASE}/${category}/${group.groupId}/products`, { signal: ctx.signal, timeoutMs: 60000 });
      if (!Array.isArray(products.results)) throw new Error('invalid products response');
      batch.products = products.results;
      await sleep(SPACING_MS);
      const prices = await fetchJson<Results<TcgPrice>>(`${TCGCSV_BASE}/${category}/${group.groupId}/prices`, { signal: ctx.signal, timeoutMs: 60000 });
      if (!Array.isArray(prices.results)) throw new Error('invalid prices response');
      batch.prices = prices.results;
      await sleep(SPACING_MS);
    } catch (e) {
      ctx.signal.throwIfAborted();
      batch.result.error = (e as Error).message;
      failedGroups++;
      log.warn(`tcgcsv ${group.name}: ${batch.result.error}`);
    }
    batches.push(batch);
  }

  const rejected = new Map<string, MarketDecision['rejected']>();
  const proposals = new Map<string, Array<{ productId: number; exact: boolean }>>();
  const productCandidates = new Map<number, string[]>();
  for (const { result, products } of batches) {
    for (const p of products) {
      const conflict = (c: MarketCard) => marketConflict(c, p, result.group, result.set, sets);
      const assigned = cards.filter((c) => c.tcgplayer_id === p.productId);
      for (const c of assigned) {
        const reason = conflict(c);
        if (reason) rejected.set(c.id, [...(rejected.get(c.id) ?? []), { productId: p.productId, reason }]);
      }
      const exact = assigned.filter((c) => !conflict(c) && !rejectedMarket(db, c.id, p.productId));
      const parsed = parseTcgNumber(numberOf(p));
      const candidates = exact.length ? exact : parsed ? cards.filter((c) => {
        if (conflict(c) || rejectedMarket(db, c.id, p.productId)) return false;
        const own = parseTcgNumber(c.number.replace(/-P(?:\d|$|-).*$/, '').replace(/-OVERSIZED$/, ''));
        if (!own || own.prefix !== parsed.prefix || own.number_int !== parsed.number_int || own.suffix !== parsed.suffix) return false;
        // Cross-set groups need an exact normalized name as well as collector/printing evidence.
        if (!result.set && nameKey(c.name) !== nameKey(p.name)) return false;
        // No inferred match without a set association or an identified promo context.
        return !!result.set || promoGroup(result.group, p);
      }) : [];
      productCandidates.set(p.productId, candidates.map((c) => c.id));
      if (candidates.length === 1) {
        const c = candidates[0];
        proposals.set(c.id, [...(proposals.get(c.id) ?? []), { productId: p.productId, exact: exact.length === 1 }]);
      }
    }
  }
  const resolved = new Map<number, string>();
  const decisions: MarketDecision[] = [];
  for (const c of cards) {
    const candidates = proposals.get(c.id) ?? [];
    const exact = candidates.filter((p) => p.exact);
    const preferred = exact.length ? exact : candidates;
    const ids = [...new Set(preferred.map((p) => p.productId))];
    const bad = rejected.get(c.id) ?? [];
    if (ids.length === 1) {
      resolved.set(ids[0], c.id);
      if (c.tcgplayer_id !== null && c.tcgplayer_id !== ids[0] && !bad.some((b) => b.productId === c.tcgplayer_id)) {
        // Rebind only when the previous assignment was disproven, or no assignment existed.
        resolved.delete(ids[0]);
        continue;
      }
      decisions.push({ cardId: c.id, productId: ids[0], rejected: bad });
    } else if (bad.length) decisions.push({ cardId: c.id, productId: null, rejected: bad });
  }
  const changed = applyMarketDecisions(db, decisions);
  for (const { result, products, prices } of batches) {
    for (const p of products) {
      if (resolved.has(p.productId)) result.matchedProducts++;
      else if ((productCandidates.get(p.productId)?.length ?? 0) > 0) result.ambiguous++;
      else if (numberOf(p)) result.unmatched.push({ productId: p.productId, name: p.name, number: numberOf(p)! });
      else result.sealed++;
    }
    for (const p of prices) {
      const id = resolved.get(p.productId);
      const finish = finishOf(p.subTypeName);
      if (!id || !finish) continue;
      const market = numOrNull(p.marketPrice), low = numOrNull(p.lowPrice), mid = numOrNull(p.midPrice), high = numOrNull(p.highPrice);
      if (market === null && low === null && mid === null && high === null) continue;
      result.rows.push({ card_id: id, finish, usd_market: market, usd_low: low, usd_mid: mid, usd_high: high, source: 'tcgplayer', source_ref: String(p.productId) });
    }
    onGroup(result);
  }
  log.info(`tcgcsv: scanned ${groups.length} groups; resolved ${resolved.size} printings; rejected ${[...rejected.values()].reduce((n, a) => n + a.length, 0)} assignments`);
  return { groups: groups.length, failedGroups, changed, resolved: resolved.size, rejected: [...rejected.values()].reduce((n, a) => n + a.length, 0) };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
