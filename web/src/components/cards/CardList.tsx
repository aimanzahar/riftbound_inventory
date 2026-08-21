import { useCallback, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../../store/store.ts';
import { openCard } from '../../lib/router.ts';
import { usePreview } from './previewStore.ts';
import { CardRow } from './CardRow.tsx';

const ROW_H = 56;

/** Virtualised 56 px rows (same roving focus model as the grid). */
export function CardList({ ids }: { ids: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const adjust = useStore((s) => s.adjust);
  const foilSticky = useStore((s) => s.ui.foilSticky);
  const hidePreview = usePreview((s) => s.hide);

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  useEffect(() => {
    if (focusIdx >= ids.length) setFocusIdx(Math.max(0, ids.length - 1));
  }, [ids.length, focusIdx]);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${pendingFocus.current}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });

  const moveFocus = useCallback(
    (next: number) => {
      if (!ids.length) return;
      const clamped = Math.max(0, Math.min(ids.length - 1, next));
      setFocusIdx(clamped);
      pendingFocus.current = clamped;
      virtualizer.scrollToIndex(clamped, { align: 'auto' });
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        pendingFocus.current = null;
      }
    },
    [ids.length, virtualizer],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).matches('[data-index]')) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(focusIdx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(focusIdx - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        moveFocus(focusIdx + 10);
        break;
      case 'PageUp':
        e.preventDefault();
        moveFocus(focusIdx - 10);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        e.preventDefault();
        moveFocus(ids.length - 1);
        break;
      case '+':
      case '=':
        e.preventDefault();
        adjust(ids[focusIdx], e.shiftKey !== foilSticky ? 'foil' : 'normal', 1);
        break;
      case '-':
      case '_':
        e.preventDefault();
        adjust(ids[focusIdx], e.shiftKey !== foilSticky ? 'foil' : 'normal', -1);
        break;
      case 'Enter':
        e.preventDefault();
        openCard(ids[focusIdx]);
        break;
    }
  };

  return (
    <div ref={scrollRef} role="table" aria-label="Cards" aria-rowcount={ids.length} onKeyDown={onKeyDown} onScroll={() => hidePreview()} className="relative h-full w-full overflow-y-auto overscroll-contain outline-none" style={{ contain: 'strict' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((v) => (
          <CardRow
            key={ids[v.index]}
            cardId={ids[v.index]}
            index={v.index}
            tabIndex={v.index === focusIdx ? 0 : -1}
            onFocusTile={setFocusIdx}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${v.start}px)` }}
          />
        ))}
      </div>
    </div>
  );
}
