// Maps a scraped meta decklist onto the sections a user-authored deck can hold.
// Pure — shared by the web UI and tests, mirroring shared/deckRules.ts.
import type { DeckCard, DeckSection, DeckUnresolved, UserDeckCard } from './types.ts';
import { isUserSection } from './deckRules.ts';

/** Mirrors MAX_DECK_QTY in server/services/decks.ts — a line above this is rejected by the API. */
export const MAX_EXPORT_QTY = 99;

/**
 * Meta section -> user section. Only `champion` moves: a champion is a Champion Unit that
 * lives in the main deck (Core Rules: "Main Deck ... exactly 40 constructed, including the
 * Chosen Champion"), and `USER_SECTIONS` has no `champion` for exactly that reason.
 */
export function userSectionFor(section: DeckSection): DeckSection | null {
  if (section === 'champion') return 'main';
  return isUserSection(section) ? section : null;
}

/** Anything with a membership test: a Set of ids and the store's `cardsById` Map both satisfy it. */
export interface CardIdLookup {
  has(id: string): boolean;
}

export interface MetaExportArgs {
  /** from metaModel.deckLines(deck) — the legend line is already injected when the list omitted it */
  lines: DeckCard[];
  unresolved: DeckUnresolved[];
  /** catalog printing ids; anything else can't be written (the API 400s on unknown ids) */
  knownCardIds: CardIdLookup;
  includeSide: boolean;
}

export interface MetaExportPlan {
  /** merged, user-legal sections only — ready for deckCards(id, 'set', items) */
  items: UserDeckCard[];
  /** copies counted towards the 56 (excludes the sideboard) */
  copies: number;
  sideCopies: number;
  /** unresolved lines, plus lines whose card_id isn't in the catalog */
  skipped: { label: string; qty: number }[];
}

/**
 * Folds a meta decklist into writable deck lines.
 * Merges duplicate (card_id, section) keys — `mode: 'set'` rejects duplicates, and folding
 * champion into main can collide with a main line for the same printing.
 */
export function planMetaExport(a: MetaExportArgs): MetaExportPlan {
  const merged = new Map<string, UserDeckCard>();
  const skipped: { label: string; qty: number }[] = [];

  for (const l of a.lines) {
    if (l.qty <= 0) continue;
    const section = userSectionFor(l.section);
    if (section === null) continue;
    if (section === 'side' && !a.includeSide) continue;
    if (!a.knownCardIds.has(l.card_id)) {
      skipped.push({ label: l.card_id, qty: l.qty });
      continue;
    }
    const key = `${l.card_id}|${section}`;
    const prev = merged.get(key);
    if (prev) prev.qty = Math.min(MAX_EXPORT_QTY, prev.qty + l.qty);
    else merged.set(key, { card_id: l.card_id, section, qty: Math.min(MAX_EXPORT_QTY, l.qty) });
  }

  for (const u of a.unresolved) {
    if (u.qty <= 0) continue;
    if (u.section === 'side' && !a.includeSide) continue;
    if (userSectionFor(u.section) === null) continue;
    skipped.push({ label: u.name ?? u.code ?? 'Unknown card', qty: u.qty });
  }

  const items = [...merged.values()];
  let copies = 0;
  let sideCopies = 0;
  for (const it of items) {
    if (it.section === 'side') sideCopies += it.qty;
    else copies += it.qty;
  }
  return { items, copies, sideCopies, skipped };
}

/** Copies in the sideboard, for the "Include sideboard (N cards)" checkbox label. */
export function sideCopiesOf(lines: DeckCard[]): number {
  let n = 0;
  for (const l of lines) if (l.section === 'side' && l.qty > 0) n += l.qty;
  return n;
}
