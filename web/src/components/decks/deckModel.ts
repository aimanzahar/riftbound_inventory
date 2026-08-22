import { useMemo } from 'react';
import type { Card, UserDeck, UserDeckCard } from '../../../../shared/types.ts';
import { validateDeck, type DeckValidation } from '../../../../shared/deckRules.ts';
import { canonicalOf, useOwnedByCanonical } from '../../store/selectors.ts';
import { useStore } from '../../store/store.ts';
import { computeDeckCompletion, type DeckCompletionInfo, type DeckLike } from '../meta/metaModel.ts';

// ---------------------------------------------------------------------------
// deck <-> completion bridge
// ---------------------------------------------------------------------------

/** A user deck as the meta completion maths wants it. The legend always lives in the `legend` section,
 *  so `legend_card_id` stays null and `deckLines`' fallback never fires. */
export function toDeckLike(deck: Pick<UserDeck, 'cards'>): DeckLike {
  return { cards: deck.cards, legend_card_id: null };
}

// ---------------------------------------------------------------------------
// "which of my decks use this card"
// ---------------------------------------------------------------------------

export interface DeckUse {
  deckId: string;
  deckName: string;
  color: string | null;
  /** copies of this card across every section of that deck */
  copies: number;
}

export interface Commitment {
  uses: DeckUse[];
  /** copies committed across every active deck */
  committed: number;
  /** copies owned across every printing and finish */
  owned: number;
  /** your decks together need more copies than you own */
  over: boolean;
}

export const NO_COMMITMENT: Commitment = { uses: [], committed: 0, owned: 0, over: false };

/**
 * canonical card id -> the decks using it.
 * Keyed canonically so a deck built on the showcase printing still tags the base card in the collection,
 * and counted across every section because a sideboard copy is a physical copy too.
 * Archived decks are excluded — those cards are back in the binder.
 */
export function computeDeckUseByCanonical(decks: UserDeck[], cardsById: Map<string, Card>): Map<string, DeckUse[]> {
  const out = new Map<string, DeckUse[]>();
  for (const d of decks) {
    if (d.archived) continue;
    const perCanon = new Map<string, number>();
    for (const c of d.cards) {
      const card = cardsById.get(c.card_id);
      const canon = card ? canonicalOf(card) : c.card_id;
      perCanon.set(canon, (perCanon.get(canon) ?? 0) + c.qty);
    }
    for (const [canon, copies] of perCanon) {
      const use: DeckUse = { deckId: d.id, deckName: d.name, color: d.color, copies };
      const arr = out.get(canon);
      if (arr) arr.push(use);
      else out.set(canon, [use]);
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => b.copies - a.copies || a.deckName.localeCompare(b.deckName));
  return out;
}

export function useDeckUseByCanonical(): Map<string, DeckUse[]> {
  const decks = useStore((s) => s.user_decks);
  const cardsById = useStore((s) => s.cardsById);
  return useMemo(() => computeDeckUseByCanonical(decks, cardsById), [decks, cardsById]);
}

/** Committed-vs-owned for one printing, resolved through its canonical card. */
export function useCommitment(card: Card | undefined): Commitment {
  const byCanon = useDeckUseByCanonical();
  const ownedByCanonical = useOwnedByCanonical();
  return useMemo(() => {
    if (!card) return NO_COMMITMENT;
    const canon = canonicalOf(card);
    const uses = byCanon.get(canon);
    if (!uses?.length) return NO_COMMITMENT;
    const committed = uses.reduce((a, u) => a + u.copies, 0);
    const owned = ownedByCanonical.get(canon) ?? 0;
    return { uses, committed, owned, over: committed > owned };
  }, [card, byCanon, ownedByCanonical]);
}

// ---------------------------------------------------------------------------
// per-deck derived data
// ---------------------------------------------------------------------------

export interface DeckModel {
  deck: UserDeck;
  completion: DeckCompletionInfo;
  validation: DeckValidation;
  /** the legend card, when the deck has one */
  legend: Card | undefined;
}

export function useDeckModel(deck: UserDeck | null | undefined): DeckModel | null {
  const cardsById = useStore((s) => s.cardsById);
  const prices = useStore((s) => s.prices);
  const playset = useStore((s) => s.settings.playset_size);
  const runePlayset = useStore((s) => s.settings.rune_playset_size);
  const ownedByCanonical = useOwnedByCanonical();
  return useMemo(() => {
    if (!deck) return null;
    const legendId = deck.cards.find((c) => c.section === 'legend')?.card_id;
    return {
      deck,
      completion: computeDeckCompletion(toDeckLike(deck), cardsById, ownedByCanonical, prices),
      validation: validateDeck({ cards: deck.cards, cardsById, playset, runePlayset }),
      legend: legendId ? cardsById.get(legendId) : undefined,
    };
  }, [deck, cardsById, ownedByCanonical, prices, playset, runePlayset]);
}

/** Current qty of one card in one section of a deck. */
export function qtyIn(deck: UserDeck | undefined, cardId: string, section: UserDeckCard['section']): number {
  return deck?.cards.find((c) => c.card_id === cardId && c.section === section)?.qty ?? 0;
}

/** Copies of a card across every section of one deck. */
export function copiesIn(deck: UserDeck | undefined, cardId: string): number {
  return deck?.cards.reduce((a, c) => (c.card_id === cardId ? a + c.qty : a), 0) ?? 0;
}

export function useUserDecks(includeArchived = false): UserDeck[] {
  const decks = useStore((s) => s.user_decks);
  return useMemo(() => {
    const list = includeArchived ? decks : decks.filter((d) => !d.archived);
    return [...list].sort((a, b) => a.archived - b.archived || b.updated_at.localeCompare(a.updated_at));
  }, [decks, includeArchived]);
}

export function useUserDeck(id: string | null | undefined): UserDeck | undefined {
  return useStore((s) => (id ? s.user_decks.find((d) => d.id === id) : undefined));
}
