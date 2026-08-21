// Job: meta — tournament decklists (riftools default | boundrift | localjson) → meta_decks + meta_deck_cards (canonical ids),
// per-deck transaction, deactivate decks older than 120 days, catalog change {what:'meta'} when anything changed.
import type { JobCtx, JobResult } from './types.ts';
import type { MetaDeckInput } from './sources/types.ts';
import { RIFTOOLS_SEEN_KEY, fetchRiftoolsDecks } from './sources/meta.riftools.ts';
import { BOUNDRIFT_SEEN_KEY, fetchBoundriftDecks } from './sources/meta.boundrift.ts';
import { loadLocalDecks } from './sources/meta.localjson.ts';
import { sha256 } from './lib/files.ts';
import { all, bumpCatalogVersion, getSetting, nowIso, one, run as sqlRun, setSetting, today } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';
import { fromRiotId, normalizeCommunityId } from '../shared/ids.ts';
import type { CatalogPayload, DeckSection, DeckUnresolved } from '../shared/types.ts';

const DEFAULT_LIMIT = 400;
const WINDOW_DAYS = 60;
const DEACTIVATE_DAYS = 120;

export function deckId(source: string, sourceUrl: string): string {
  return sha256(`${source}|${sourceUrl}`).slice(0, 16);
}

function dayMinus(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/** 'OGN-043/298' | 'OGN-043' | 'ogn-043-298' | 'OGN-303-STAR' → our id (not validated against the DB). */
export function codeToId(code: string | null | undefined): string | null {
  if (!code) return null;
  const bare = String(code).trim().replace(/\/.*$/, '');
  return normalizeCommunityId(bare) ?? fromRiotId(String(code).trim())?.id ?? null;
}

interface CardLite {
  id: string;
  name: string;
  type: string | null;
  variant_of: string | null;
}

export interface Resolver {
  canonical(code: string | null | undefined): string | null;
  legendByName(name: string | null | undefined): string | null;
}

export function buildResolver(ctx: Pick<JobCtx, 'db'>): Resolver {
  const cards = all<CardLite>(ctx.db, 'SELECT id, name, type, variant_of FROM cards WHERE active = 1');
  const byId = new Map(cards.map((c) => [c.id, c]));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const legends = new Map<string, string>(); // normalised name → canonical id
  for (const c of cards) {
    if ((c.type ?? '').toLowerCase() !== 'legend') continue;
    const canon = c.variant_of ?? c.id;
    const key = norm(c.name);
    if (!legends.has(key) || c.variant_of === null) legends.set(key, canon);
  }
  return {
    canonical(code) {
      const id = codeToId(code);
      if (!id) return null;
      const c = byId.get(id);
      if (!c) return null;
      return c.variant_of && byId.has(c.variant_of) ? c.variant_of : c.id;
    },
    legendByName(name) {
      if (!name) return null;
      const n = norm(name);
      if (legends.has(n)) return legends.get(n)!;
      const comma = name.indexOf(',');
      if (comma >= 0) {
        const sub = norm(name.slice(comma + 1));
        if (legends.has(sub)) return legends.get(sub)!;
      }
      for (const [k, id] of legends) if (n.endsWith(' ' + k)) return id;
      return null;
    },
  };
}

interface DeckRowDb {
  id: string;
  name: string;
  legend_card_id: string | null;
  legend_name: string | null;
  champion_card_id: string | null;
  format: string | null;
  source: string;
  source_url: string;
  player: string | null;
  event_name: string | null;
  event_date: string | null;
  event_players: number | null;
  event_tier: string | null;
  placement: number | null;
  region: string | null;
  unresolved: string;
  active: number;
}

export interface IngestStats {
  added: number;
  updated: number;
  unchanged: number;
  unresolvedCards: number;
  unresolvedSample: string[];
}

/** Upsert one deck (+ replace its cards) in one transaction. */
export function ingestDeck(ctx: Pick<JobCtx, 'db'>, r: Resolver, d: MetaDeckInput, stats: IngestStats): void {
  const { db } = ctx;
  const id = deckId(d.source, d.source_url);
  const merged = new Map<string, { card_id: string; section: DeckSection; qty: number }>();
  const unresolved: DeckUnresolved[] = [];
  for (const c of d.cards) {
    const cid = r.canonical(c.code);
    if (!cid) {
      unresolved.push({ code: c.code ?? undefined, name: c.name ?? undefined, qty: c.qty, section: c.section });
      continue;
    }
    const key = `${cid}|${c.section}`;
    const prev = merged.get(key);
    if (prev) prev.qty += c.qty;
    else merged.set(key, { card_id: cid, section: c.section, qty: c.qty });
  }
  let legendId = r.canonical(d.legend_code) ?? r.legendByName(d.legend_name);
  if (!legendId) {
    const fromCards = [...merged.values()].find((x) => x.section === 'legend');
    if (fromCards) legendId = fromCards.card_id;
  }
  let championId = r.canonical(d.champion_code);
  if (!championId) {
    const fromCards = [...merged.values()].find((x) => x.section === 'champion');
    if (fromCards) championId = fromCards.card_id;
  }
  const next = {
    name: d.name,
    legend_card_id: legendId,
    legend_name: d.legend_name,
    champion_card_id: championId,
    format: d.format,
    source: d.source,
    source_url: d.source_url,
    player: d.player,
    event_name: d.event_name,
    event_date: d.event_date,
    event_players: d.event_players,
    event_tier: d.event_tier,
    placement: d.placement,
    region: d.region,
    unresolved: JSON.stringify(unresolved),
    active: 1,
  };
  const cardsKey = [...merged.values()]
    .sort((a, b) => a.section.localeCompare(b.section) || a.card_id.localeCompare(b.card_id))
    .map((c) => `${c.section}:${c.card_id}:${c.qty}`)
    .join(';');
  stats.unresolvedCards += unresolved.length;
  for (const u of unresolved) if (stats.unresolvedSample.length < 10 && u.code && !stats.unresolvedSample.includes(u.code)) stats.unresolvedSample.push(u.code);

  db.tx(() => {
    const prev = one<DeckRowDb>(db, 'SELECT id, name, legend_card_id, legend_name, champion_card_id, format, source, source_url, player, event_name, event_date, event_players, event_tier, placement, region, unresolved, active FROM meta_decks WHERE id = ?', id);
    const prevCards = prev
      ? all<{ card_id: string; section: DeckSection; qty: number }>(db, 'SELECT card_id, section, qty FROM meta_deck_cards WHERE deck_id = ? ORDER BY section, card_id', id)
          .map((c) => `${c.section}:${c.card_id}:${Number(c.qty)}`)
          .join(';')
      : null;
    const prevCmp = prev
      ? {
          name: prev.name,
          legend_card_id: prev.legend_card_id,
          legend_name: prev.legend_name,
          champion_card_id: prev.champion_card_id,
          format: prev.format,
          source: prev.source,
          source_url: prev.source_url,
          player: prev.player,
          event_name: prev.event_name,
          event_date: prev.event_date,
          event_players: prev.event_players === null ? null : Number(prev.event_players),
          event_tier: prev.event_tier,
          placement: prev.placement === null ? null : Number(prev.placement),
          region: prev.region,
          unresolved: prev.unresolved,
          active: Number(prev.active),
        }
      : null;
    if (prevCmp && JSON.stringify(prevCmp) === JSON.stringify(next) && prevCards === cardsKey) {
      stats.unchanged++;
      return;
    }
    sqlRun(
      db,
      `INSERT INTO meta_decks(id, name, legend_card_id, legend_name, champion_card_id, format, source, source_url, player, event_name, event_date, event_players, event_tier, placement, region, unresolved, fetched_at, active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, legend_card_id=excluded.legend_card_id, legend_name=excluded.legend_name, champion_card_id=excluded.champion_card_id,
         format=excluded.format, source=excluded.source, source_url=excluded.source_url, player=excluded.player, event_name=excluded.event_name, event_date=excluded.event_date,
         event_players=excluded.event_players, event_tier=excluded.event_tier, placement=excluded.placement, region=excluded.region, unresolved=excluded.unresolved,
         fetched_at=excluded.fetched_at, active=1`,
      id,
      next.name,
      next.legend_card_id,
      next.legend_name,
      next.champion_card_id,
      next.format,
      next.source,
      next.source_url,
      next.player,
      next.event_name,
      next.event_date,
      next.event_players,
      next.event_tier,
      next.placement,
      next.region,
      next.unresolved,
      nowIso(),
    );
    sqlRun(db, 'DELETE FROM meta_deck_cards WHERE deck_id = ?', id);
    const ins = db.raw.prepare('INSERT INTO meta_deck_cards(deck_id, card_id, section, qty) VALUES (?,?,?,?)');
    for (const c of merged.values()) ins.run(id, c.card_id, c.section, c.qty);
    if (prev) stats.updated++;
    else stats.added++;
  });
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, cfg, log } = ctx;
  const primary = typeof ctx.flags.source === 'string' ? ctx.flags.source : cfg.metaSource || 'riftools';
  const limitFlag = Number(ctx.flags.limit);
  const limit = Number.isFinite(limitFlag) && limitFlag > 0 ? Math.floor(limitFlag) : DEFAULT_LIMIT;
  const cutoff = dayMinus(WINDOW_DAYS);
  const resolver = buildResolver(ctx);
  const stats: IngestStats = { added: 0, updated: 0, unchanged: 0, unresolvedCards: 0, unresolvedSample: [] };
  const notes: string[] = [];
  let failedDecks = 0;
  let decks = 0;
  let sourceFailures = 0;

  const onDeck = (d: MetaDeckInput) => {
    decks++;
    ingestDeck(ctx, resolver, d, stats);
  };

  const runRiftools = async () => {
    const seen = getSetting<Record<string, string>>(db, RIFTOOLS_SEEN_KEY, {});
    const r = await fetchRiftoolsDecks(ctx, { limit, cutoffDay: cutoff, seen: ctx.flags.force ? {} : seen, onDeck });
    failedDecks += r.failedDecks;
    if (Object.keys(r.seenUpdates).length) setSetting(db, RIFTOOLS_SEEN_KEY, { ...seen, ...r.seenUpdates });
    notes.push(`riftools: ${r.decks} decks from ${r.events} events (${r.skippedEvents} unchanged skipped${r.truncated ? `, stopped at --limit ${limit}` : ''})${r.failedDecks ? `, ${r.failedDecks} failed` : ''}`);
  };
  const runBoundrift = async () => {
    const seen = getSetting<Record<string, string>>(db, BOUNDRIFT_SEEN_KEY, {});
    const r = await fetchBoundriftDecks(ctx, { limit, cutoffDay: cutoff, seen: ctx.flags.force ? {} : seen, onDeck });
    failedDecks += r.failedDecks;
    if (Object.keys(r.seenUpdates).length) setSetting(db, BOUNDRIFT_SEEN_KEY, { ...seen, ...r.seenUpdates });
    notes.push(`boundrift: ${r.decks} decks from ${r.events} events (${r.skippedEvents} unchanged skipped${r.truncated ? `, stopped at --limit ${limit}` : ''})${r.failedDecks ? `, ${r.failedDecks} failed` : ''}`);
  };
  const runLocal = async () => {
    const list = await loadLocalDecks(ctx);
    for (const d of list.slice(0, limit)) onDeck(d);
    notes.push(`localjson: ${Math.min(list.length, limit)} decks`);
  };

  const order: Array<[string, () => Promise<void>]> =
    primary === 'boundrift' ? [['boundrift', runBoundrift], ['riftools', runRiftools]] : primary === 'localjson' ? [['localjson', runLocal]] : [['riftools', runRiftools], ['boundrift', runBoundrift]];
  if (!['riftools', 'boundrift', 'localjson'].includes(primary)) throw new Error(`unknown meta source "${primary}" (expected riftools|boundrift|localjson)`);

  for (const [name, fn] of order) {
    try {
      await fn();
      break; // primary succeeded (even with 0 decks) → no fallback
    } catch (e) {
      sourceFailures++;
      const msg = `${name} failed: ${(e as Error).message}`;
      log.warn(msg);
      notes.push(msg);
    }
  }
  if (sourceFailures === order.length) {
    return { ok: 0, failed: 1, message: `error: all meta sources failed (${notes.join(' · ')})`, changed: false };
  }

  // deactivate stale decks
  const deactivated = sqlRun(db, 'UPDATE meta_decks SET active = 0 WHERE active = 1 AND event_date IS NOT NULL AND event_date < ?', dayMinus(DEACTIVATE_DAYS)).changes;
  const changed = stats.added + stats.updated + deactivated > 0;
  if (changed) {
    db.tx(() => {
      const version = bumpCatalogVersion(db);
      const payload: CatalogPayload = {
        what: 'meta',
        catalog_version: version,
        stats: { decks, added: stats.added, updated: stats.updated, unchanged: stats.unchanged, deactivated, unresolved_cards: stats.unresolvedCards },
      };
      insertChange(db, { kind: 'catalog', reason: 'meta', payload });
    });
  }
  const activeDecks = Number(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM meta_decks WHERE active = 1')?.n ?? 0);
  const message = [
    ...notes,
    `ingested ${decks} (added ${stats.added}, updated ${stats.updated}, unchanged ${stats.unchanged})`,
    `unresolved cards ${stats.unresolvedCards}${stats.unresolvedSample.length ? ` (e.g. ${stats.unresolvedSample.join(', ')})` : ''}`,
    `deactivated ${deactivated}, active decks ${activeDecks}`,
    `window ${cutoff}..${today()}`,
  ].join(' · ');
  log.info(message);
  return { ok: decks, failed: failedDecks + sourceFailures, message, changed };
}
