import { useCallback, useEffect, useRef } from 'react';
import type { FocusEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Card } from '../../../../shared/types.ts';
import { preload } from '../../lib/images.ts';
import { usePreview, rectOf } from '../cards/previewStore.ts';

const HOVER_DELAY = 120;

export interface CardHoverHandlers {
  onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
}

/**
 * Same hover / keyboard-focus preview behaviour as a CardTile, for any element that stands for a card
 * (deck rows, legend art). Mouse only; keyboard focus-visible shows the same popover.
 */
export function useCardHover(card: Pick<Card, 'id' | 'image_url'> | null | undefined): CardHoverHandlers {
  const show = usePreview((s) => s.show);
  const hide = usePreview((s) => s.hide);
  const timer = useRef<number | null>(null);
  const id = card?.id ?? null;
  const imageUrl = card?.image_url ?? null;

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  // unmount / card change: drop a pending timer and any preview we own
  useEffect(
    () => () => {
      clear();
      if (id) hide(id);
    },
    [clear, hide, id],
  );

  const onPointerEnter = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || !id) return;
      void preload({ id, image_url: imageUrl }, 'full');
      clear();
      const el = e.currentTarget;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (el.isConnected) show(id, rectOf(el), 'mouse');
      }, HOVER_DELAY);
    },
    [id, imageUrl, clear, show],
  );

  const onPointerLeave = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || !id) return;
      clear();
      hide(id);
    },
    [id, clear, hide],
  );

  const onFocus = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (!id || e.target !== e.currentTarget) return;
      if (e.currentTarget.matches(':focus-visible')) show(id, rectOf(e.currentTarget), 'focus');
    },
    [id, show],
  );

  const onBlur = useCallback(
    (e: FocusEvent<HTMLElement>) => {
      if (!id || e.target !== e.currentTarget) return;
      clear();
      hide(id);
    },
    [id, clear, hide],
  );

  return { onPointerEnter, onPointerLeave, onFocus, onBlur };
}
