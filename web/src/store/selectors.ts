import { useMemo } from 'react';
import type { Card, Deck, InventoryRow, Price, Product, PurchaseRecord, SetRow } from '../../../shared/types.ts';
import { DOMAIN_ORDER, RARITY_ORDER, TYPE_ORDER } from '../../../shared/constants.ts';
import { searchCards } from '../../../shared/search.ts';
import { hoursSince } from '../lib/format.ts';
import { displayedQty, useStore } from './store.ts';
import { invKey, type Filters, type SortKey } from './types.ts';

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

export function canonicalOf(card: Pick<Card, 'id' | 'variant_of'>): string {
  return card.variant_of ?? card.id;
}

export function isToken(card: Pick<Card, 'type'>): boolean {
  return card.type === 'Token';
}

export interface Usage {
  /** distinct meta decks using the card */
  decks: number;
  /** total copies across decks */
  copies: number;
  /** by legend name → deck count */
  byLegend: Map<string, { decks: number; copies: number }>;
}

/** canonical card id → usage across active meta decks */
export function computeUsageByCard(decks: Deck[]): Map<string, Usage> {
  const out = new Map<string, Usage>();
  for (const d of decks) {
    const legend = d.legend_name ?? 'Unknown legend';
    const seen = new Set<string>();
    for (const c of d.cards) {
      let u = out.get(c.card_id);
      if (!u) {
        u = { decks: 0, copies: 0, byLegend: new Map() };
        out.set(c.card_id, u);
      }
      const l = u.byLegend.get(legend) ?? { decks: 0, copies: 0 };
      u.copies += c.qty;
      l.copies += c.qty;
      if (!seen.has(c.card_id)) {
        seen.add(c.card_id);
        u.decks++;
        l.decks++;
      }
      u.byLegend.set(legend, l);
    }
  }
  return out;
}

/** canonical card id → owned copies across printings + finishes (server truth, no pending) */
export function computeOwnedByCanonical(cardsById: Map<string, Card>, inventory: Map<string, InventoryRow>): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of inventory.values()) {
    if (row.qty <= 0) continue;
    const card = cardsById.get(row.card_id);
    const canon = card ? canonicalOf(card) : row.card_id;
    out.set(canon, (out.get(canon) ?? 0) + row.qty);
  }
  return out;
}

export interface Totals {
  uniqueOwned: number;
  uniqueTotal: number;
  copies: number;
  foilCopies: number;
  valueUsd: number;
  valueMyr: number | null;
  pricedCopies: number;
  unpricedCopies: number;
}

export function computeTotals(cardsById: Map<string, Card>, inventory: Map<string, InventoryRow>, prices: Map<string, Price>, fxRate: number | null): Totals {
  const canonAll = new Set<string>();
  for (const c of cardsById.values()) if (!isToken(c)) canonAll.add(canonicalOf(c));
  const canonOwned = new Set<string>();
  let copies = 0,
    foil = 0,
    usd = 0,
    priced = 0,
    unpriced = 0;
  for (const row of inventory.values()) {
    if (row.qty <= 0) continue;
    const card = cardsById.get(row.card_id);
    if (!card || isToken(card)) continue;
    canonOwned.add(canonicalOf(card));
    copies += row.qty;
    if (row.finish === 'foil') foil += row.qty;
    // exact finish → normal → foil (Rares/Epics are foil-only, so a "normal" row still values at the foil price)
    const p = prices.get(invKey(row.card_id, row.finish)) ?? prices.get(invKey(row.card_id, 'normal')) ?? prices.get(invKey(row.card_id, 'foil'));
    const m = p?.usd_market ?? p?.usd_mid ?? null;
    if (m !== null && m !== undefined) {
      usd += m * row.qty;
      priced += row.qty;
    } else unpriced += row.qty;
  }
  return {
    uniqueOwned: canonOwned.size,
    uniqueTotal: canonAll.size,
    copies,
    foilCopies: foil,
    valueUsd: Math.round(usd * 100) / 100,
    valueMyr: fxRate ? Math.round(usd * fxRate * 100) / 100 : null,
    pricedCopies: priced,
    unpricedCopies: unpriced,
  };
}

export interface VisibleArgs {
  cards: Card[];
  sets: SetRow[];
  filters: Filters;
  search: string;
  sort: SortKey;
  inventory: Map<string, InventoryRow>;
  prices: Map<string, Price>;
  usage: Map<string, Usage>;
  ownedByCanonical: Map<string, number>;
  playset: number;
  runePlayset: number;
}

function totalQty(inv: Map<string, InventoryRow>, id: string): number {
  return (inv.get(invKey(id, 'normal'))?.qty ?? 0) + (inv.get(invKey(id, 'foil'))?.qty ?? 0);
}

export function cardPasses(card: Card, a: Omit<VisibleArgs, 'cards' | 'sets' | 'search' | 'sort'>): boolean {
  const f = a.filters;
  if (f.sets.length && !f.sets.includes(card.set_code)) return false;
  if (f.types.length && !f.types.includes(card.type ?? '')) return false;
  if (f.rarities.length && !f.rarities.includes(card.rarity ?? '')) return false;
  if (f.domains.length && !card.domains.some((d) => f.domains.includes(d))) return false;
  if (f.own !== 'all') {
    const q = totalQty(a.inventory, card.id);
    if (f.own === 'owned' && q <= 0) return false;
    if (f.own === 'missing' && q > 0) return false;
    if (f.own === 'extras') {
      const owned = a.ownedByCanonical.get(canonicalOf(card)) ?? 0;
      const P = card.type === 'Rune' ? a.runePlayset : a.playset;
      if (owned <= P) return false;
    }
  }
  if (f.foil && (a.inventory.get(invKey(card.id, 'foil'))?.qty ?? 0) <= 0) return false;
  if (f.meta && !a.usage.has(canonicalOf(card))) return false;
  return true;
}

export function computeVisibleIds(a: VisibleArgs): string[] {
  const setOrder = new Map<string, number>();
  a.sets.forEach((s, i) => setOrder.set(s.code, i));
  const candidates: Card[] = [];
  for (const c of a.cards) if (cardPasses(c, a)) candidates.push(c);

  const byNumber = (x: Card, y: Card) =>
    (setOrder.get(x.set_code) ?? 999) - (setOrder.get(y.set_code) ?? 999) || x.set_code.localeCompare(y.set_code) || x.number_int - y.number_int || x.number.localeCompare(y.number);

  const q = a.search.trim();
  if (q) {
    const ownedIds = new Set<string>();
    for (const row of a.inventory.values()) if (row.qty > 0) ownedIds.add(row.card_id);
    return searchCards(q, candidates, ownedIds, 800).map((c) => c.id);
  }

  switch (a.sort) {
    case 'name':
      candidates.sort((x, y) => x.name.localeCompare(y.name) || byNumber(x, y));
      break;
    case 'price': {
      const priceOf = (c: Card) => a.prices.get(invKey(c.id, 'normal'))?.usd_market ?? a.prices.get(invKey(c.id, 'foil'))?.usd_market ?? -1;
      candidates.sort((x, y) => priceOf(y) - priceOf(x) || byNumber(x, y));
      break;
    }
    case 'qty':
      candidates.sort((x, y) => totalQty(a.inventory, y.id) - totalQty(a.inventory, x.id) || byNumber(x, y));
      break;
    case 'recent': {
      const recent = (c: Card) => {
        const n = a.inventory.get(invKey(c.id, 'normal'))?.updated_at ?? '';
        const f = a.inventory.get(invKey(c.id, 'foil'))?.updated_at ?? '';
        return n > f ? n : f;
      };
      candidates.sort((x, y) => (recent(y) > recent(x) ? 1 : recent(y) < recent(x) ? -1 : 0) || byNumber(x, y));
      break;
    }
    default:
      candidates.sort(byNumber);
  }
  return candidates.map((c) => c.id);
}

export interface FacetCounts {
  sets: Map<string, number>;
  domains: Map<string, number>;
  types: Map<string, number>;
  rarities: Map<string, number>;
  own: { all: number; owned: number; missing: number; extras: number };
  foil: number;
  meta: number;
}

/** Counts per option, each computed with every OTHER filter group applied. */
export function computeFacetCounts(a: Omit<VisibleArgs, 'sort' | 'search'>): FacetCounts {
  const sets = new Map<string, number>(),
    domains = new Map<string, number>(),
    types = new Map<string, number>(),
    rarities = new Map<string, number>();
  const own = { all: 0, owned: 0, missing: 0, extras: 0 };
  let foil = 0,
    meta = 0;
  const f = a.filters;
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const c of a.cards) {
    const base = { ...a, filters: f };
    // group-specific "without this group" checks
    if (cardPasses(c, { ...base, filters: { ...f, sets: [] } })) bump(sets, c.set_code);
    if (cardPasses(c, { ...base, filters: { ...f, domains: [] } })) for (const d of c.domains) bump(domains, d);
    if (cardPasses(c, { ...base, filters: { ...f, types: [] } })) bump(types, c.type ?? 'Other');
    if (cardPasses(c, { ...base, filters: { ...f, rarities: [] } })) bump(rarities, c.rarity ?? 'Unknown');
    if (cardPasses(c, { ...base, filters: { ...f, own: 'all' } })) {
      own.all++;
      const q = totalQty(a.inventory, c.id);
      if (q > 0) own.owned++;
      else own.missing++;
      const P = c.type === 'Rune' ? a.runePlayset : a.playset;
      if ((a.ownedByCanonical.get(canonicalOf(c)) ?? 0) > P) own.extras++;
    }
    if (cardPasses(c, { ...base, filters: { ...f, foil: false } }) && (a.inventory.get(invKey(c.id, 'foil'))?.qty ?? 0) > 0) foil++;
    if (cardPasses(c, { ...base, filters: { ...f, meta: false } }) && a.usage.has(canonicalOf(c))) meta++;
  }
  return { sets, domains, types, rarities, own, foil, meta };
}

export interface ProductStatus {
  timesBought: number;
  lastBought: PurchaseRecord | null;
  /** owned share of the product's distinct cards (0..1), null when no fixed list */
  pctOwned: number | null;
  distinct: number;
}

export function computeProductStatus(p: Product, purchases: PurchaseRecord[], ownedByCanonical: Map<string, number>, cardsById: Map<string, Card>): ProductStatus {
  const mine = purchases.filter((x) => x.product_id === p.id && !x.undone);
  const canon = new Set<string>();
  for (const c of p.contents) {
    const card = cardsById.get(c.card_id);
    canon.add(card ? canonicalOf(card) : c.card_id);
  }
  let owned = 0;
  for (const id of canon) if ((ownedByCanonical.get(id) ?? 0) > 0) owned++;
  return { timesBought: mine.length, lastBought: mine[0] ?? null, pctOwned: canon.size ? owned / canon.size : null, distinct: canon.size };
}

/** prices older than this are shown amber */
export const PRICE_STALE_HOURS = 36;

export function priceIsStale(fetchedAt: string | null | undefined): boolean {
  return hoursSince(fetchedAt) > PRICE_STALE_HOURS;
}

export function sortedOptions(values: Iterable<string>, order: string[]): string[] {
  const arr = [...values];
  return arr.sort((a, b) => {
    const ia = order.indexOf(a),
      ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

const EMPTY_ARR: string[] = [];

export function useCard(id: string | null | undefined): Card | undefined {
  return useStore((s) => (id ? s.cardsById.get(id) : undefined));
}

export function useQty(cardId: string, finish: 'normal' | 'foil'): number {
  return useStore((s) => displayedQty(s, cardId, finish));
}

export function useOwnedTotal(cardId: string): number {
  return useStore((s) => displayedQty(s, cardId, 'normal') + displayedQty(s, cardId, 'foil'));
}

export function useUsageByCard(): Map<string, Usage> {
  const decks = useStore((s) => s.decks);
  return useMemo(() => computeUsageByCard(decks), [decks]);
}

export function useOwnedByCanonical(): Map<string, number> {
  const cardsById = useStore((s) => s.cardsById);
  const inventory = useStore((s) => s.inventory);
  return useMemo(() => computeOwnedByCanonical(cardsById, inventory), [cardsById, inventory]);
}

export function useCards(): Card[] {
  const cardsById = useStore((s) => s.cardsById);
  const cardIds = useStore((s) => s.cardIds);
  return useMemo(() => cardIds.map((id) => cardsById.get(id)!).filter(Boolean), [cardIds, cardsById]);
}

export function useVisibleIds(): string[] {
  const cards = useCards();
  const sets = useStore((s) => s.sets);
  const filters = useStore((s) => s.ui.filters);
  const search = useStore((s) => s.ui.search);
  const sort = useStore((s) => s.ui.sort);
  const needsInv = filters.own !== 'all' || filters.foil || sort === 'qty' || sort === 'recent' || search.trim().length > 0;
  const inventory = useStore((s) => (needsInv ? s.inventory : null));
  const prices = useStore((s) => (sort === 'price' ? s.prices : null));
  const playset = useStore((s) => s.settings.playset_size);
  const runePlayset = useStore((s) => s.settings.rune_playset_size);
  const usage = useUsageByCard();
  const ownedByCanonical = useOwnedByCanonical();
  const owned = filters.own === 'extras' ? ownedByCanonical : null;
  const inv = inventory ?? EMPTY_INV;
  const pr = prices ?? EMPTY_PRICES;
  const ob = owned ?? EMPTY_OWNED;
  return useMemo(
    () => (cards.length ? computeVisibleIds({ cards, sets, filters, search, sort, inventory: inv, prices: pr, usage, ownedByCanonical: ob, playset, runePlayset }) : EMPTY_ARR),
    [cards, sets, filters, search, sort, inv, pr, usage, ob, playset, runePlayset],
  );
}

const EMPTY_INV = new Map<string, InventoryRow>();
const EMPTY_PRICES = new Map<string, Price>();
const EMPTY_OWNED = new Map<string, number>();

export function useTotals(): Totals {
  const cardsById = useStore((s) => s.cardsById);
  const inventory = useStore((s) => s.inventory);
  const prices = useStore((s) => s.prices);
  const rate = useStore((s) => s.fx?.rate ?? null);
  return useMemo(() => computeTotals(cardsById, inventory, prices, rate), [cardsById, inventory, prices, rate]);
}

export function useFacetCounts(): FacetCounts {
  const cards = useCards();
  const sets = useStore((s) => s.sets);
  const filters = useStore((s) => s.ui.filters);
  const inventory = useStore((s) => s.inventory);
  const prices = EMPTY_PRICES;
  const playset = useStore((s) => s.settings.playset_size);
  const runePlayset = useStore((s) => s.settings.rune_playset_size);
  const usage = useUsageByCard();
  const ownedByCanonical = useOwnedByCanonical();
  return useMemo(
    () => computeFacetCounts({ cards, sets, filters, inventory, prices, usage, ownedByCanonical, playset, runePlayset }),
    [cards, sets, filters, inventory, prices, usage, ownedByCanonical, playset, runePlayset],
  );
}

export interface FacetOptions {
  sets: string[];
  domains: string[];
  types: string[];
  rarities: string[];
}

/** Distinct option values present in the catalog, in canonical display order. */
export function useFacetOptions(): FacetOptions {
  const cards = useCards();
  const sets = useStore((s) => s.sets);
  return useMemo(() => {
    const domains = new Set<string>(),
      types = new Set<string>(),
      rarities = new Set<string>(),
      setCodes = new Set<string>();
    for (const c of cards) {
      setCodes.add(c.set_code);
      for (const d of c.domains) domains.add(d);
      if (c.type) types.add(c.type);
      if (c.rarity) rarities.add(c.rarity);
    }
    const setOrder = sets.map((s) => s.code);
    return {
      sets: sortedOptions(setCodes, setOrder),
      domains: sortedOptions(domains, DOMAIN_ORDER),
      types: sortedOptions(types, TYPE_ORDER),
      rarities: sortedOptions(rarities, RARITY_ORDER),
    };
  }, [cards, sets]);
}

export function useCardUsage(card: Card | undefined): Usage | undefined {
  const usage = useUsageByCard();
  return card ? usage.get(canonicalOf(card)) : undefined;
}

export function useProductsForCard(cardId: string | undefined): Product[] {
  const products = useStore((s) => s.products);
  return useMemo(() => (cardId ? products.filter((p) => p.contents.some((c) => c.card_id === cardId)) : []), [products, cardId]);
}

/** other printings of the same card (variants + canonical) */
export function usePrintingsOf(card: Card | undefined): Card[] {
  const cards = useCards();
  return useMemo(() => {
    if (!card) return [];
    const canon = canonicalOf(card);
    return cards.filter((c) => c.id !== card.id && canonicalOf(c) === canon);
  }, [cards, card]);
}
