// riftools.app — tournament results + decklists (undocumented JSON; ≤2 req/s, weekly use).
//   /api/tournaments → items[]; /api/tournament?url=… → rows[]; /api/deck?url=… → cards[]
import type { JobCtx } from '../types.ts';
import type { MetaDeckCardInput, MetaDeckInput } from './types.ts';
import { fetchJson, sleep } from '../lib/http.ts';
import type { DeckSection } from '../../shared/types.ts';

export const RIFTOOLS_BASE = 'https://www.riftools.app/api';
const SPACING_MS = 750; // well under 2 req/s — riftools 429s bursts
export const RIFTOOLS_SEEN_KEY = 'meta_riftools_seen';

/** fetchJson that backs off on HTTP 429 (Too Many Requests): 5 s, 10 s, 20 s, then gives up. */
export async function fetchJsonPolite<T>(url: string, signal: AbortSignal, timeoutMs = 30000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fetchJson<T>(url, { signal, timeoutMs, retries: 1 });
    } catch (e) {
      lastErr = e;
      if (signal.aborted || !/HTTP 429\b/.test((e as Error).message) || attempt === 3) throw e;
      await sleep(5000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface RiftoolsTournament {
  name: string;
  event_date: string;
  players?: number | null;
  region?: string | null;
  quality_tier?: string | null;
  parsed_count?: number | null;
  refreshed_at?: string | null;
  tournament_url: string;
  set_window?: string | null;
}
interface RiftoolsRow {
  rank?: number | string | null;
  placement?: number | string | null;
  player_name?: string | null;
  legend_name?: string | null;
  legend_public_code?: string | null;
  champion?: string | null;
  champion_public_code?: string | null;
  deck_url?: string | null;
  deck_name?: string | null;
  parse_status?: string | null;
}
interface RiftoolsDeckCard {
  card_name?: string | null;
  card_type?: string | null;
  count?: number | string | null;
  public_code?: string | null;
}

export function sectionFromCardType(t: string | null | undefined): DeckSection {
  const s = (t ?? '').toLowerCase();
  if (s === 'legend') return 'legend';
  if (s === 'champion') return 'champion';
  if (s === 'battlefield' || s === 'battlefields') return 'battlefield';
  if (s === 'rune' || s === 'runes') return 'runes';
  if (s === 'sideboard' || s === 'side') return 'side';
  return 'main';
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** Pick events: last `days` days; premier/major preferred, else the top 12 by player count; newest first. */
export function selectTournaments(items: RiftoolsTournament[], cutoffDay: string): RiftoolsTournament[] {
  const recent = items.filter((t) => t && typeof t.tournament_url === 'string' && typeof t.event_date === 'string' && t.event_date >= cutoffDay && Number(t.parsed_count ?? 0) > 0);
  const tiered = recent.filter((t) => ['premier', 'major'].includes(String(t.quality_tier ?? '').toLowerCase()));
  const chosen = tiered.length ? tiered : [...recent].sort((a, b) => Number(b.players ?? 0) - Number(a.players ?? 0)).slice(0, 12);
  return chosen.sort((a, b) => b.event_date.localeCompare(a.event_date) || Number(b.players ?? 0) - Number(a.players ?? 0));
}

export function mapRiftoolsDeck(ev: RiftoolsTournament, row: RiftoolsRow, cards: RiftoolsDeckCard[]): MetaDeckInput {
  const deckCards: MetaDeckCardInput[] = [];
  let legendCode = row.legend_public_code ?? null;
  let championCode = row.champion_public_code ?? null;
  for (const c of cards) {
    const qty = toInt(c.count) ?? 0;
    if (qty <= 0) continue;
    const section = sectionFromCardType(c.card_type);
    if (section === 'legend' && !legendCode) legendCode = c.public_code ?? null;
    if (section === 'champion' && !championCode) championCode = c.public_code ?? null;
    deckCards.push({ code: c.public_code ?? null, name: c.card_name ?? null, qty, section });
  }
  const legend = row.legend_name?.trim() || null;
  const champion = row.champion?.trim() || null;
  const name = legend ? `${legend}${champion ? ` · ${champion}` : ''}` : row.deck_name?.trim() || champion || 'Deck';
  return {
    source: 'riftools',
    source_url: String(row.deck_url),
    name,
    legend_name: legend,
    legend_code: legendCode,
    champion_code: championCode,
    player: row.player_name?.trim() || null,
    event_name: ev.name ?? null,
    event_date: ev.event_date ?? null,
    event_players: toInt(ev.players),
    event_tier: ev.quality_tier ?? null,
    placement: toInt(row.placement) ?? toInt(row.rank),
    region: ev.region ?? null,
    format: 'constructed',
    cards: deckCards,
  };
}

export interface RiftoolsFetchOpts {
  limit: number; // max decks this run
  cutoffDay: string; // 'YYYY-MM-DD'
  seen: Record<string, string>; // tournament_url → refreshed_at already ingested
  onDeck: (deck: MetaDeckInput) => void;
}

export interface RiftoolsFetchResult {
  events: number; // events processed (at least partially)
  skippedEvents: number; // unchanged since last run
  decks: number;
  failedDecks: number;
  seenUpdates: Record<string, string>; // events fully processed this run
  truncated: boolean; // hit the deck limit
}

export async function fetchRiftoolsDecks(ctx: JobCtx, o: RiftoolsFetchOpts): Promise<RiftoolsFetchResult> {
  const { log } = ctx;
  const list = await fetchJsonPolite<{ items?: RiftoolsTournament[] }>(`${RIFTOOLS_BASE}/tournaments`, ctx.signal);
  const items = Array.isArray(list.items) ? list.items : [];
  if (!items.length) throw new Error('riftools: no tournaments returned');
  const chosen = selectTournaments(items, o.cutoffDay);
  log.info(`riftools: ${items.length} tournaments, ${chosen.length} selected since ${o.cutoffDay}`);
  const res: RiftoolsFetchResult = { events: 0, skippedEvents: 0, decks: 0, failedDecks: 0, seenUpdates: {}, truncated: false };
  let i = 0;
  for (const ev of chosen) {
    if (ctx.signal.aborted) break;
    ctx.progress(i++, chosen.length, `riftools ${ev.name}`);
    const stamp = String(ev.refreshed_at ?? ev.event_date ?? '');
    if (o.seen[ev.tournament_url] && o.seen[ev.tournament_url] === stamp) {
      res.skippedEvents++;
      continue;
    }
    if (res.decks >= o.limit) {
      res.truncated = true;
      break;
    }
    res.events++;
    await sleep(SPACING_MS);
    let rows: RiftoolsRow[];
    try {
      const t = await fetchJsonPolite<{ rows?: RiftoolsRow[] }>(`${RIFTOOLS_BASE}/tournament?url=${encodeURIComponent(ev.tournament_url)}`, ctx.signal);
      rows = Array.isArray(t.rows) ? t.rows : [];
    } catch (e) {
      log.warn(`riftools tournament ${ev.tournament_url} failed: ${(e as Error).message}`);
      res.failedDecks++;
      continue;
    }
    const top = rows
      .filter((r) => r && typeof r.deck_url === 'string' && r.deck_url && ((toInt(r.placement) ?? toInt(r.rank) ?? 999) <= 16))
      .filter((r) => !r.parse_status || String(r.parse_status).toLowerCase() === 'parsed')
      .sort((a, b) => (toInt(a.placement) ?? toInt(a.rank) ?? 999) - (toInt(b.placement) ?? toInt(b.rank) ?? 999));
    let complete = true;
    let eventFailures = 0;
    for (const row of top) {
      if (ctx.signal.aborted) {
        complete = false;
        break;
      }
      if (res.decks >= o.limit) {
        complete = false;
        res.truncated = true;
        break;
      }
      await sleep(SPACING_MS);
      try {
        const deckUrl = `${RIFTOOLS_BASE}/deck?url=${encodeURIComponent(String(row.deck_url))}`;
        let cards: RiftoolsDeckCard[] = [];
        let lastErr = '';
        // riftools sometimes answers {error:"Decklist data is temporarily unavailable.", available:false} → retry a few times
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await sleep(3000 * attempt);
          const d = await fetchJsonPolite<{ cards?: RiftoolsDeckCard[]; error?: string; available?: boolean }>(deckUrl, ctx.signal);
          cards = Array.isArray(d.cards) ? d.cards : [];
          if (cards.length) break;
          lastErr = d.error ? String(d.error) : 'empty card list';
          if (!d.error && d.available !== false) break; // genuinely empty → don't hammer
        }
        if (!cards.length) {
          res.failedDecks++;
          eventFailures++;
          log.warn(`riftools deck ${row.deck_url}: ${lastErr}`);
          continue;
        }
        o.onDeck(mapRiftoolsDeck(ev, row, cards));
        res.decks++;
      } catch (e) {
        res.failedDecks++;
        eventFailures++;
        log.warn(`riftools deck ${row.deck_url} failed: ${(e as Error).message}`);
      }
    }
    // only remember fully-ingested events; anything with failures is retried next run
    if (complete && eventFailures === 0) res.seenUpdates[ev.tournament_url] = stamp;
    if (res.truncated) break;
  }
  return res;
}
