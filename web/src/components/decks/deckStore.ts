import { create } from 'zustand';
import type { DeckSection } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { qtyIn, useUserDeck } from './deckModel.ts';

/**
 * Optimistic overlay for deck line edits, so holding `+` on a card feels instant.
 * displayed qty = server qty + Σ in-flight deltas. A delta is dropped once `deckCards` resolves —
 * by then the server change has already been ingested, so the two never double-count.
 * Deliberately thinner than store/optimistic.ts: deck edits are one card at a time and are not retried,
 * they just surface a toast on failure (the store action does that).
 */
export function lineKey(deckId: string, cardId: string, section: DeckSection): string {
  return `${deckId}|${cardId}|${section}`;
}

interface DeckUi {
  pending: Map<string, number>;
  bump(key: string, delta: number): void;
  drop(key: string, delta: number): void;
}

export const useDeckUi = create<DeckUi>()((set, get) => ({
  pending: new Map(),
  bump(key, delta) {
    const next = new Map(get().pending);
    const v = (next.get(key) ?? 0) + delta;
    if (v === 0) next.delete(key);
    else next.set(key, v);
    set({ pending: next });
  },
  drop(key, delta) {
    get().bump(key, -delta);
  },
}));

/** Server qty plus any in-flight delta. */
export function useLineQty(deckId: string, cardId: string, section: DeckSection): number {
  const deck = useUserDeck(deckId);
  const pending = useDeckUi((s) => s.pending.get(lineKey(deckId, cardId, section)) ?? 0);
  return Math.max(0, qtyIn(deck, cardId, section) + pending);
}

/** Apply ±delta to one line, clamped at zero, with the overlay held until the server answers. */
export async function adjustLine(deckId: string, cardId: string, section: DeckSection, delta: number, label?: string): Promise<void> {
  const store = useStore.getState();
  const deck = store.user_decks.find((d) => d.id === deckId);
  const key = lineKey(deckId, cardId, section);
  const shown = Math.max(0, qtyIn(deck, cardId, section) + (useDeckUi.getState().pending.get(key) ?? 0));
  const effective = shown + delta < 0 ? -shown : delta;
  if (effective === 0) return;
  useDeckUi.getState().bump(key, effective);
  try {
    await store.deckCards(deckId, 'add', [{ card_id: cardId, section, qty: effective }], label);
  } finally {
    useDeckUi.getState().drop(key, effective);
  }
}

/** Move a line to another section, preserving its quantity. */
export async function moveLine(deckId: string, cardId: string, from: DeckSection, to: DeckSection, label?: string): Promise<void> {
  if (from === to) return;
  const store = useStore.getState();
  const deck = store.user_decks.find((d) => d.id === deckId);
  const qty = qtyIn(deck, cardId, from);
  if (qty <= 0) return;
  await store.deckCards(
    deckId,
    'set',
    [
      { card_id: cardId, section: from, qty: 0 },
      { card_id: cardId, section: to, qty: qtyIn(deck, cardId, to) + qty },
    ],
    label,
  );
}
