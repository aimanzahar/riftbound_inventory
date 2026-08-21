// BoundRift — per-player decklists for majors (undocumented JSON).
//   /api/events → [{id,name,startDatetime,startingPlayerCount,eventCategory,decksIngestedAt,…}]
//   /api/events/{id}/standings → {standings:[{rank,playerId,username,legendName,hasDeck}]}
//   /api/events/{id}/players/{playerId}/deck → {sections:[{type,cards:[{cardId:'ogs-019-024',code:'OGS-019/024',name,quantity}]}]}
import type { JobCtx } from '../types.ts';
import type { MetaDeckCardInput, MetaDeckInput } from './types.ts';
import { sleep } from '../lib/http.ts';
import { fetchJsonPolite } from './meta.riftools.ts';
import type { DeckSection } from '../../shared/types.ts';

export const BOUNDRIFT_BASE = 'https://boundrift.com/api';
const SPACING_MS = 500;
export const BOUNDRIFT_SEEN_KEY = 'meta_boundrift_seen';

export interface BoundriftEvent {
  id: number | string;
  name: string;
  startDatetime?: string | null;
  startingPlayerCount?: number | null;
  eventCategory?: string | null;
  decksIngestedAt?: string | null;
  lifecycleStatus?: string | null;
}
interface Standing {
  rank?: number | null;
  playerId?: number | string | null;
  username?: string | null;
  legendName?: string | null;
  hasDeck?: boolean | null;
}
interface DeckCard {
  cardId?: string | null;
  code?: string | null;
  name?: string | null;
  quantity?: number | null;
}
interface DeckSectionJson {
  type?: string | null;
  cards?: DeckCard[];
}
interface DeckJson {
  name?: string | null;
  format?: string | null;
  region?: string | null;
  legend?: { name?: string | null } | null;
  sections?: DeckSectionJson[];
}

export function sectionFromBoundrift(t: string | null | undefined): DeckSection | null {
  const s = (t ?? '').toLowerCase();
  if (s === 'legend') return 'legend';
  if (s === 'champion') return 'champion';
  if (s === 'battlefield' || s === 'battlefields') return 'battlefield';
  if (s === 'rune_pool' || s === 'runes' || s === 'rune') return 'runes';
  if (s === 'sideboard' || s === 'side') return 'side';
  if (s === 'main' || s === 'main_deck' || s === 'maindeck') return 'main';
  if (s === 'considering') return null; // not part of the deck
  return 'main';
}

export function selectEvents(events: BoundriftEvent[], cutoffDay: string): BoundriftEvent[] {
  return events
    .filter((e) => e && e.id !== undefined && e.decksIngestedAt && typeof e.startDatetime === 'string' && e.startDatetime.slice(0, 10) >= cutoffDay)
    .sort((a, b) => String(b.startDatetime).localeCompare(String(a.startDatetime)) || Number(b.startingPlayerCount ?? 0) - Number(a.startingPlayerCount ?? 0));
}

export function mapBoundriftDeck(ev: BoundriftEvent, st: Standing, deck: DeckJson, sourceUrl: string): MetaDeckInput {
  const cards: MetaDeckCardInput[] = [];
  let legendCode: string | null = null;
  let championCode: string | null = null;
  let championName: string | null = null;
  for (const sec of deck.sections ?? []) {
    const section = sectionFromBoundrift(sec.type);
    if (!section) continue;
    for (const c of sec.cards ?? []) {
      const qty = Math.floor(Number(c.quantity ?? 0));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const code = c.cardId || c.code || null;
      if (section === 'legend' && !legendCode) legendCode = code;
      if (section === 'champion' && !championCode) {
        championCode = code;
        championName = c.name ?? null;
      }
      cards.push({ code, name: c.name ?? null, qty, section });
    }
  }
  const legend = st.legendName?.trim() || deck.legend?.name?.trim() || null;
  const name = legend ? `${legend}${championName ? ` · ${championName}` : ''}` : deck.name?.trim() || 'Deck';
  return {
    source: 'boundrift',
    source_url: sourceUrl,
    name,
    legend_name: legend,
    legend_code: legendCode,
    champion_code: championCode,
    player: st.username?.trim() || null,
    event_name: ev.name ?? null,
    event_date: typeof ev.startDatetime === 'string' ? ev.startDatetime.slice(0, 10) : null,
    event_players: ev.startingPlayerCount === null || ev.startingPlayerCount === undefined ? null : Number(ev.startingPlayerCount),
    event_tier: ev.eventCategory ?? null,
    placement: st.rank === null || st.rank === undefined ? null : Number(st.rank),
    region: typeof deck.region === 'string' && deck.region ? deck.region : null,
    format: (deck.format ?? 'constructed').toLowerCase(),
    cards,
  };
}

export interface BoundriftFetchOpts {
  limit: number;
  cutoffDay: string;
  seen: Record<string, string>; // event id → decksIngestedAt
  onDeck: (deck: MetaDeckInput) => void;
}
export interface BoundriftFetchResult {
  events: number;
  skippedEvents: number;
  decks: number;
  failedDecks: number;
  seenUpdates: Record<string, string>;
  truncated: boolean;
}

export async function fetchBoundriftDecks(ctx: JobCtx, o: BoundriftFetchOpts): Promise<BoundriftFetchResult> {
  const { log } = ctx;
  const raw = await fetchJsonPolite<BoundriftEvent[] | { events?: BoundriftEvent[]; items?: BoundriftEvent[] }>(`${BOUNDRIFT_BASE}/events`, ctx.signal);
  const events = Array.isArray(raw) ? raw : Array.isArray(raw.events) ? raw.events : Array.isArray(raw.items) ? raw.items : [];
  if (!events.length) throw new Error('boundrift: no events returned');
  const chosen = selectEvents(events, o.cutoffDay);
  log.info(`boundrift: ${events.length} events, ${chosen.length} with decks since ${o.cutoffDay}`);
  const res: BoundriftFetchResult = { events: 0, skippedEvents: 0, decks: 0, failedDecks: 0, seenUpdates: {}, truncated: false };
  let i = 0;
  for (const ev of chosen) {
    if (ctx.signal.aborted) break;
    ctx.progress(i++, chosen.length, `boundrift ${ev.name}`);
    const key = String(ev.id);
    const stamp = String(ev.decksIngestedAt);
    if (o.seen[key] && o.seen[key] === stamp) {
      res.skippedEvents++;
      continue;
    }
    if (res.decks >= o.limit) {
      res.truncated = true;
      break;
    }
    res.events++;
    await sleep(SPACING_MS);
    let standings: Standing[];
    try {
      const s = await fetchJsonPolite<{ standings?: Standing[] }>(`${BOUNDRIFT_BASE}/events/${encodeURIComponent(key)}/standings`, ctx.signal);
      standings = Array.isArray(s.standings) ? s.standings : [];
    } catch (e) {
      log.warn(`boundrift standings ${key} failed: ${(e as Error).message}`);
      res.failedDecks++;
      continue;
    }
    const top = standings.filter((s) => s && s.hasDeck && Number(s.rank ?? 999) <= 16 && s.playerId !== null && s.playerId !== undefined).sort((a, b) => Number(a.rank ?? 999) - Number(b.rank ?? 999));
    let complete = true;
    let eventFailures = 0;
    for (const st of top) {
      if (ctx.signal.aborted) {
        complete = false;
        break;
      }
      if (res.decks >= o.limit) {
        complete = false;
        res.truncated = true;
        break;
      }
      const url = `${BOUNDRIFT_BASE}/events/${encodeURIComponent(key)}/players/${encodeURIComponent(String(st.playerId))}/deck`;
      await sleep(SPACING_MS);
      try {
        const d = await fetchJsonPolite<DeckJson>(url, ctx.signal);
        if (!Array.isArray(d.sections) || !d.sections.length) {
          res.failedDecks++;
          eventFailures++;
          continue;
        }
        o.onDeck(mapBoundriftDeck(ev, st, d, url));
        res.decks++;
      } catch (e) {
        res.failedDecks++;
        eventFailures++;
        log.warn(`boundrift deck ${url} failed: ${(e as Error).message}`);
      }
    }
    if (complete && eventFailures === 0) res.seenUpdates[key] = stamp;
    if (res.truncated) break;
  }
  return res;
}
