import { useMemo } from 'react';
import type { Card, Deck, DeckCard, DeckSection, Price } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { canonicalOf, useOwnedByCanonical } from '../../store/selectors.ts';
import { invKey } from '../../store/types.ts';

// ---------------------------------------------------------------------------
// constants / query state
// ---------------------------------------------------------------------------

export const SECTION_ORDER: readonly DeckSection[] = ['legend', 'champion', 'battlefield', 'main', 'runes', 'side'];
export const SECTION_LABELS: Record<DeckSection, string> = {
  legend: 'Legend',
  champion: 'Champion',
  battlefield: 'Battlefields',
  main: 'Main deck',
  runes: 'Runes',
  side: 'Sideboard',
};

export type DaysWindow = 30 | 60 | 120 | 0;
export const DAYS_OPTIONS: ReadonlyArray<{ value: DaysWindow; label: string; title: string }> = [
  { value: 30, label: '30 d', title: 'Events in the last 30 days' },
  { value: 60, label: '60 d', title: 'Events in the last 60 days' },
  { value: 120, label: '120 d', title: 'Events in the last 120 days' },
  { value: 0, label: 'All', title: 'Every tracked deck' },
];

export type MetaSort = 'share' | 'recent' | 'completion';
export const META_SORTS: readonly MetaSort[] = ['share', 'recent', 'completion'];
export const META_SORT_LABELS: Record<MetaSort, string> = { share: 'Share', recent: 'Recent', completion: 'Completion' };

/** Meta page state as it appears in the hash query (`#/meta?days=30&tier=premier&region=EMEA&legend=…&deck=…&sort=recent&q=…`). */
export interface MetaQuery {
  days: DaysWindow;
  tiers: string[];
  regions: string[];
  /** selected archetype (legend key) — also the “legend” filter */
  legend: string | null;
  /** explicitly selected deck id inside the archetype */
  deck: string | null;
  sort: MetaSort;
  q: string;
}

export const DEFAULT_META_QUERY: MetaQuery = { days: 60, tiers: [], regions: [], legend: null, deck: null, sort: 'share', q: '' };

function list(p: URLSearchParams, key: string): string[] {
  const v = p.get(key);
  if (!v) return [];
  return [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
}

export function parseMetaQuery(p: URLSearchParams): MetaQuery {
  const daysRaw = p.get('days');
  const daysNum = daysRaw === null ? 60 : Number(daysRaw);
  const days: DaysWindow = daysNum === 30 || daysNum === 120 || daysNum === 0 ? daysNum : 60;
  const sortRaw = p.get('sort') as MetaSort | null;
  return {
    days,
    tiers: list(p, 'tier').map((t) => t.toLowerCase()),
    regions: list(p, 'region'),
    legend: p.get('legend') || null,
    deck: p.get('deck') || null,
    sort: sortRaw && META_SORTS.includes(sortRaw) ? sortRaw : 'share',
    q: p.get('q') ?? '',
  };
}

export function metaQueryToParams(m: MetaQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (m.days !== 60) p.set('days', String(m.days));
  if (m.tiers.length) p.set('tier', m.tiers.join(','));
  if (m.regions.length) p.set('region', m.regions.join(','));
  if (m.q) p.set('q', m.q);
  if (m.sort !== 'share') p.set('sort', m.sort);
  if (m.legend) p.set('legend', m.legend);
  if (m.deck) p.set('deck', m.deck);
  return p;
}

export function metaFilterCount(m: MetaQuery): number {
  return m.tiers.length + m.regions.length + (m.days !== 60 ? 1 : 0) + (m.q.trim() ? 1 : 0);
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function tierOf(d: Pick<Deck, 'event_tier'>): string {
  return (d.event_tier ?? 'other').toLowerCase();
}
export function tierLabel(key: string): string {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Other';
}
export function regionOf(d: Pick<Deck, 'region'>): string {
  return d.region ?? 'Unknown';
}
export function legendKey(d: Pick<Deck, 'legend_name' | 'legend_card_id'>): string {
  return d.legend_name ?? d.legend_card_id ?? 'Unknown legend';
}

/** ISO day (YYYY-MM-DD) for the start of the window; null = no cutoff. */
export function windowCutoff(days: DaysWindow, now: number = Date.now()): string | null {
  if (!days) return null;
  return new Date(now - days * DAY_MS).toISOString().slice(0, 10);
}

/** most recent event first, then best placement, then bigger events */
export function byRecent(a: Deck, b: Deck): number {
  return (b.event_date ?? '').localeCompare(a.event_date ?? '') || (a.placement ?? 999) - (b.placement ?? 999) || (b.event_players ?? 0) - (a.event_players ?? 0) || a.id.localeCompare(b.id);
}

/** The representative list of an archetype: the most recent top-8 finish (or the most recent deck when none made top 8). */
export function pickRepresentative(decks: Deck[]): Deck | null {
  if (!decks.length) return null;
  const top = decks.filter((d) => d.placement !== null && d.placement <= 8);
  const pool = top.length ? top : decks;
  return [...pool].sort(byRecent)[0] ?? null;
}

/** Deck lines incl. the legend itself when the source list omitted it. */
export function deckLines(deck: Deck): DeckCard[] {
  const lines = [...deck.cards];
  if (deck.legend_card_id && !lines.some((l) => l.section === 'legend')) lines.unshift({ card_id: deck.legend_card_id, section: 'legend', qty: 1 });
  return lines;
}

/** Champion name(s) as written in the deck name (“Legend · Champion”), falling back to the champion card. */
export function championNames(deck: Deck, cardsById: Map<string, Card>): string[] {
  const parts = deck.name.split(' · ').map((s) => s.trim()).filter(Boolean);
  const fromName = parts.length > 1 ? parts.slice(1) : [];
  if (fromName.length) return fromName;
  const c = deck.champion_card_id ? cardsById.get(deck.champion_card_id) : undefined;
  return c ? [c.name] : [];
}

export function unitPrice(prices: Map<string, Price>, cardId: string): number | null {
  const p = prices.get(invKey(cardId, 'normal')) ?? prices.get(invKey(cardId, 'foil'));
  return p?.usd_market ?? p?.usd_mid ?? null;
}

/** “Open source” label for a deck's source URL (riftools lists are often WeChat deep links). */
export function sourceLabel(url: string): string {
  const scheme = (url.split(':')[0] ?? '').toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return host.length > 28 ? `${host.slice(0, 26)}…` : host;
    } catch {
      return 'web';
    }
  }
  if (scheme === 'wechat') return 'WeChat';
  return scheme || 'source';
}
export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// ---------------------------------------------------------------------------
// completion
// ---------------------------------------------------------------------------

export type LineTone = 'complete' | 'partial' | 'missing';

export interface DeckLine {
  card_id: string;
  section: DeckSection;
  qty: number;
  /** copies allocated from the collection (legend → champion → battlefields → main → runes → side) */
  owned: number;
  tone: LineTone;
  card: Card | undefined;
}

export interface DeckCompletionInfo {
  lines: DeckLine[];
  /** copies needed / owned / missing — sideboard excluded */
  total: number;
  owned: number;
  missing: number;
  pct: number;
  sideTotal: number;
  sideOwned: number;
  sideMissing: number;
  distinctMissing: number;
  /** estimated cost of the missing (non-side) copies at TCGplayer market, USD */
  costUsd: number;
  pricedMissing: number;
  unpricedMissing: number;
}

const SECTION_RANK = new Map<DeckSection, number>(SECTION_ORDER.map((s, i) => [s, i]));

/** owned = Σ min(needed, owned canonical copies), allocated section by section so a card split between main and side shows the right chips. */
export function computeDeckCompletion(deck: Deck, cardsById: Map<string, Card>, ownedByCanonical: Map<string, number>, prices: Map<string, Price> | null): DeckCompletionInfo {
  const nameOf = (id: string) => cardsById.get(id)?.name ?? id;
  const sorted = deckLines(deck).sort(
    (a, b) => (SECTION_RANK.get(a.section) ?? 99) - (SECTION_RANK.get(b.section) ?? 99) || nameOf(a.card_id).localeCompare(nameOf(b.card_id)) || a.card_id.localeCompare(b.card_id),
  );
  const remaining = new Map<string, number>();
  const missingByCanon = new Map<string, number>();
  const lines: DeckLine[] = [];
  let total = 0,
    owned = 0,
    sideTotal = 0,
    sideOwned = 0;
  for (const l of sorted) {
    const card = cardsById.get(l.card_id);
    const canon = card ? canonicalOf(card) : l.card_id;
    if (!remaining.has(canon)) remaining.set(canon, ownedByCanonical.get(canon) ?? 0);
    const avail = remaining.get(canon) ?? 0;
    const take = Math.min(l.qty, avail);
    remaining.set(canon, avail - take);
    const tone: LineTone = take >= l.qty ? 'complete' : take > 0 ? 'partial' : 'missing';
    lines.push({ card_id: l.card_id, section: l.section, qty: l.qty, owned: take, tone, card });
    if (l.section === 'side') {
      sideTotal += l.qty;
      sideOwned += take;
    } else {
      total += l.qty;
      owned += take;
      if (take < l.qty) missingByCanon.set(canon, (missingByCanon.get(canon) ?? 0) + (l.qty - take));
    }
  }
  let costUsd = 0,
    priced = 0,
    unpriced = 0;
  for (const [canon, n] of missingByCanon) {
    const usd = prices ? unitPrice(prices, canon) : null;
    if (usd === null) unpriced += n;
    else {
      priced += n;
      costUsd += usd * n;
    }
  }
  return {
    lines,
    total,
    owned,
    missing: total - owned,
    pct: total ? owned / total : 0,
    sideTotal,
    sideOwned,
    sideMissing: sideTotal - sideOwned,
    distinctMissing: missingByCanon.size,
    costUsd: Math.round(costUsd * 100) / 100,
    pricedMissing: priced,
    unpricedMissing: unpriced,
  };
}

// ---------------------------------------------------------------------------
// archetypes
// ---------------------------------------------------------------------------

export interface CardUse {
  decks: number;
  avgCopies: number;
}

export interface Archetype {
  key: string;
  legendName: string;
  legendCardId: string | null;
  legendCard: Card | undefined;
  champions: string[];
  /** every deck of this legend inside the date/tier/region window (recent first) */
  decks: Deck[];
  /** decks that also pass search / “uses card” narrowing (recent first) */
  shown: Deck[];
  /** decks / all decks in the window */
  share: number;
  best: number | null;
  avg: number | null;
  top8: number;
  latest: string | null;
  events: number;
  representative: Deck;
  completion: DeckCompletionInfo;
  /** when a focus card is set: how this archetype plays it */
  cardUse: CardUse | null;
}

export interface FacetCount {
  key: string;
  count: number;
}

export interface MetaModel {
  archetypes: Archetype[];
  /** decks in the date/tier/region window */
  windowTotal: number;
  /** decks after search / focus-card narrowing */
  shownTotal: number;
  events: number;
  tiers: FacetCount[];
  regions: FacetCount[];
  legends: Array<{ key: string; name: string; count: number }>;
  cardUse: (CardUse & { archetypes: number }) | null;
  narrowed: boolean;
}

export interface MetaModelArgs {
  decks: Deck[];
  query: MetaQuery;
  /** canonical id of the focus card (`?card=`), or null */
  cardCanon: string | null;
  cardsById: Map<string, Card>;
  ownedByCanonical: Map<string, number>;
  prices: Map<string, Price>;
  now?: number;
}

function deckCopiesOf(d: Deck, canon: string, cardsById: Map<string, Card>): number {
  let n = 0;
  for (const c of d.cards) {
    const card = cardsById.get(c.card_id);
    if ((card ? canonicalOf(card) : c.card_id) === canon) n += c.qty;
  }
  return n;
}

function deckMatches(d: Deck, q: string): boolean {
  return [d.legend_name, d.name, d.player, d.event_name, d.region].some((s) => s !== null && s.toLowerCase().includes(q));
}

function mostCommon(values: Array<string | null>): string | null {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  let best: string | null = null,
    n = 0;
  for (const [k, c] of m)
    if (c > n) {
      best = k;
      n = c;
    }
  return best;
}

export function computeMetaModel(a: MetaModelArgs): MetaModel {
  const cutoff = windowCutoff(a.query.days, a.now ?? Date.now());
  const q = a.query.q.trim().toLowerCase();
  const tierSet = new Set(a.query.tiers);
  const regionSet = new Set(a.query.regions);
  const tierCounts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  const windowDecks: Deck[] = [];
  for (const d of a.decks) {
    if (cutoff && (!d.event_date || d.event_date < cutoff)) continue;
    const t = tierOf(d),
      r = regionOf(d);
    tierCounts.set(t, (tierCounts.get(t) ?? 0) + 1);
    regionCounts.set(r, (regionCounts.get(r) ?? 0) + 1);
    if (tierSet.size && !tierSet.has(t)) continue;
    if (regionSet.size && !regionSet.has(r)) continue;
    windowDecks.push(d);
  }

  const groups = new Map<string, Deck[]>();
  for (const d of windowDecks) {
    const k = legendKey(d);
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }
  const legends = [...groups.entries()].map(([key, ds]) => ({ key, name: ds[0]?.legend_name ?? key, count: ds.length })).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));

  const narrowed = Boolean(a.cardCanon) || q.length > 0;
  const narrow = (d: Deck): boolean => {
    if (a.cardCanon && deckCopiesOf(d, a.cardCanon, a.cardsById) <= 0) return false;
    if (q && !deckMatches(d, q)) return false;
    return true;
  };

  const archetypes: Archetype[] = [];
  const eventSet = new Set<string>();
  let shownTotal = 0,
    useDecks = 0,
    useCopies = 0;
  for (const [key, ds] of groups) {
    ds.sort(byRecent);
    const shown = ds.filter(narrow);
    const first = shown[0];
    if (!first) continue;
    const representative = pickRepresentative(shown) ?? first;
    const placements = shown.map((d) => d.placement).filter((p): p is number => p !== null);
    const legendCardId = mostCommon(ds.map((d) => d.legend_card_id));
    const champions: string[] = [];
    for (const d of shown) for (const c of championNames(d, a.cardsById)) if (!champions.includes(c)) champions.push(c);
    const events = new Set<string>();
    for (const d of shown) {
      const ev = `${d.event_name ?? ''}|${d.event_date ?? ''}`;
      events.add(ev);
      eventSet.add(ev);
    }
    let cardUse: CardUse | null = null;
    if (a.cardCanon) {
      let copies = 0;
      for (const d of shown) copies += deckCopiesOf(d, a.cardCanon, a.cardsById);
      cardUse = { decks: shown.length, avgCopies: copies / shown.length };
      useDecks += shown.length;
      useCopies += copies;
    }
    shownTotal += shown.length;
    archetypes.push({
      key,
      legendName: ds[0]?.legend_name ?? key,
      legendCardId,
      legendCard: legendCardId ? a.cardsById.get(legendCardId) : undefined,
      champions,
      decks: ds,
      shown,
      share: windowDecks.length ? ds.length / windowDecks.length : 0,
      best: placements.length ? Math.min(...placements) : null,
      avg: placements.length ? placements.reduce((s, p) => s + p, 0) / placements.length : null,
      top8: placements.filter((p) => p <= 8).length,
      latest: shown.reduce<string | null>((m, d) => (d.event_date && (!m || d.event_date > m) ? d.event_date : m), null),
      events: events.size,
      representative,
      completion: computeDeckCompletion(representative, a.cardsById, a.ownedByCanonical, a.prices),
      cardUse,
    });
  }

  const byName = (x: Archetype, y: Archetype) => x.legendName.localeCompare(y.legendName);
  switch (a.query.sort) {
    case 'recent':
      archetypes.sort((x, y) => (y.latest ?? '').localeCompare(x.latest ?? '') || y.decks.length - x.decks.length || byName(x, y));
      break;
    case 'completion':
      archetypes.sort((x, y) => y.completion.pct - x.completion.pct || y.completion.owned - x.completion.owned || y.decks.length - x.decks.length || byName(x, y));
      break;
    default:
      archetypes.sort((x, y) => y.decks.length - x.decks.length || y.shown.length - x.shown.length || byName(x, y));
  }

  const facet = (m: Map<string, number>): FacetCount[] => [...m.entries()].map(([key, count]) => ({ key, count })).sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));
  return {
    archetypes,
    windowTotal: windowDecks.length,
    shownTotal,
    events: eventSet.size,
    tiers: facet(tierCounts),
    regions: facet(regionCounts),
    legends,
    cardUse: a.cardCanon ? { archetypes: archetypes.length, decks: useDecks, avgCopies: useDecks ? useCopies / useDecks : 0 } : null,
    narrowed,
  };
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

export function useMetaModel(query: MetaQuery, cardCanon: string | null): MetaModel {
  const decks = useStore((s) => s.decks);
  const cardsById = useStore((s) => s.cardsById);
  const prices = useStore((s) => s.prices);
  const ownedByCanonical = useOwnedByCanonical();
  return useMemo(() => computeMetaModel({ decks, query, cardCanon, cardsById, ownedByCanonical, prices }), [decks, query, cardCanon, cardsById, ownedByCanonical, prices]);
}

export function useDeckCompletion(deck: Deck | null | undefined): DeckCompletionInfo | null {
  const cardsById = useStore((s) => s.cardsById);
  const prices = useStore((s) => s.prices);
  const ownedByCanonical = useOwnedByCanonical();
  return useMemo(() => (deck ? computeDeckCompletion(deck, cardsById, ownedByCanonical, prices) : null), [deck, cardsById, ownedByCanonical, prices]);
}
