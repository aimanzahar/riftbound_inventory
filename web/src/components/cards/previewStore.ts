import { create } from 'zustand';

export interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PreviewState {
  /** hover / keyboard preview */
  cardId: string | null;
  rect: AnchorRect | null;
  via: 'mouse' | 'focus' | null;
  /** touch long-press sheet */
  sheetCardId: string | null;
  show(cardId: string, rect: AnchorRect, via: 'mouse' | 'focus'): void;
  hide(cardId?: string): void;
  openSheet(cardId: string): void;
  closeSheet(): void;
}

/** Tiny separate store so hover state never re-renders the main tree. */
export const usePreview = create<PreviewState>()((set, get) => ({
  cardId: null,
  rect: null,
  via: null,
  sheetCardId: null,
  show: (cardId, rect, via) => set({ cardId, rect, via }),
  hide: (cardId) => {
    if (cardId && get().cardId !== cardId) return;
    if (get().cardId !== null) set({ cardId: null, rect: null, via: null });
  },
  openSheet: (cardId) => set({ sheetCardId: cardId, cardId: null, rect: null, via: null }),
  closeSheet: () => set({ sheetCardId: null }),
}));

export function rectOf(el: Element): AnchorRect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}
