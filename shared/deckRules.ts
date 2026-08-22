// Riftbound deck-construction rules for user-authored decks. Pure — shared by the server, the web UI and tests.
// Guidance only: nothing here blocks a write. The builder shows the counters and warnings, the user decides.
import type { Card, DeckSection, UserDeckCard } from './types.ts';
import { canonicalId } from './dupes.ts';

/** Sections a user deck can use. `champion` exists in the schema for parity with scraped meta decks, but a
 *  champion is a unit that lives in the main deck, so the builder never puts a card there. */
export const USER_SECTIONS: readonly DeckSection[] = ['legend', 'battlefield', 'main', 'runes', 'side'];

/** Copies each section must hold for a legal deck (1 Legend + 3 battlefields + 40 main + 12 runes = 56).
 *  `side` is optional and has no target. See docs/sources.md. */
export const DECK_TARGETS: Partial<Record<DeckSection, number>> = { legend: 1, battlefield: 3, main: 40, runes: 12 };

export type DeckCardInfo = Pick<Card, 'id' | 'name' | 'type' | 'variant_of' | 'banned'>;

export function isUserSection(s: unknown): s is DeckSection {
  return typeof s === 'string' && (USER_SECTIONS as readonly string[]).includes(s);
}

/** Where a card goes when you add it without picking a section. */
export function sectionForCard(card: Pick<Card, 'type'>): DeckSection {
  switch (card.type) {
    case 'Legend':
      return 'legend';
    case 'Battlefield':
      return 'battlefield';
    case 'Rune':
      return 'runes';
    default:
      return 'main';
  }
}

export interface SectionStatus {
  section: DeckSection;
  count: number;
  /** null when the section has no required size (sideboard) */
  target: number | null;
  ok: boolean;
}

export type DeckIssueKind = 'section_over' | 'section_under' | 'over_playset' | 'banned';

export interface DeckIssue {
  kind: DeckIssueKind;
  text: string;
  section?: DeckSection;
  /** canonical id for over_playset, printing id for banned */
  card_id?: string;
  count?: number;
  limit?: number;
}

export interface DeckValidation {
  sections: SectionStatus[];
  issues: DeckIssue[];
  /** every section on target, no playset breach, no banned card */
  legal: boolean;
  /** copies across every section, sideboard included */
  totalCopies: number;
}

export interface ValidateDeckArgs {
  cards: UserDeckCard[];
  cardsById: Map<string, DeckCardInfo>;
  playset: number;
  runePlayset: number;
}

/**
 * Counts sections against their targets and copies against the playset limit.
 * Playset counting is per CANONICAL card and spans every section: an alt-art and its base printing are the
 * same card, and three in the main deck plus one in the sideboard is four copies of it.
 */
export function validateDeck(a: ValidateDeckArgs): DeckValidation {
  const bySection = new Map<DeckSection, number>();
  const byCanon = new Map<string, { copies: number; name: string; isRune: boolean }>();
  const banned = new Map<string, string>();
  let totalCopies = 0;

  for (const line of a.cards) {
    if (line.qty <= 0) continue;
    totalCopies += line.qty;
    bySection.set(line.section, (bySection.get(line.section) ?? 0) + line.qty);

    const card = a.cardsById.get(line.card_id);
    const canon = canonicalId(card, line.card_id);
    const entry = byCanon.get(canon);
    if (entry) entry.copies += line.qty;
    else byCanon.set(canon, { copies: line.qty, name: card?.name ?? line.card_id, isRune: card?.type === 'Rune' });
    if (card?.banned === 1) banned.set(line.card_id, card.name);
  }

  const sections: SectionStatus[] = USER_SECTIONS.map((section) => {
    const count = bySection.get(section) ?? 0;
    const target = DECK_TARGETS[section] ?? null;
    return { section, count, target, ok: target === null || count === target };
  });

  const issues: DeckIssue[] = [];
  for (const s of sections) {
    if (s.target === null || s.ok) continue;
    const over = s.count > s.target;
    issues.push({
      kind: over ? 'section_over' : 'section_under',
      section: s.section,
      count: s.count,
      limit: s.target,
      text: over ? `${s.count}/${s.target} — ${s.count - s.target} too many` : `${s.count}/${s.target} — ${s.target - s.count} more needed`,
    });
  }
  for (const [canon, v] of byCanon) {
    const limit = v.isRune ? a.runePlayset : a.playset;
    if (v.copies > limit) issues.push({ kind: 'over_playset', card_id: canon, count: v.copies, limit, text: `${v.copies}× ${v.name} exceeds the limit of ${limit}` });
  }
  for (const [id, name] of banned) issues.push({ kind: 'banned', card_id: id, text: `${name} is banned` });

  return { sections, issues, legal: issues.length === 0, totalCopies };
}
