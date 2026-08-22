import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../../store/store.ts';
import { openCard } from '../../lib/router.ts';
import { usePreview } from './previewStore.ts';
import { CardTile } from './CardTile.tsx';

const GAP_DESKTOP = 12;
const GAP_PHONE = 8;
const PAD_DESKTOP = 16;
const PAD_PHONE = 10;
const MIN_TILE_DESKTOP = 150;
const MIN_TILE_PHONE = 110;
/** text block below the image (name, meta, footer) incl. tile padding */
const TILE_EXTRA = 108;
/** the deck-chip row, reserved on every tile once any deck exists so row heights stay uniform */
const TILE_CHIP_ROW = 20;

interface Layout {
  width: number;
  cols: number;
  tileW: number;
  gap: number;
  pad: number;
  rowH: number;
}

function computeLayout(width: number, coarse: boolean, chipRow: boolean): Layout {
  const phone = width < 640;
  const gap = phone ? GAP_PHONE : GAP_DESKTOP;
  const pad = phone ? PAD_PHONE : PAD_DESKTOP;
  const min = phone ? MIN_TILE_PHONE : MIN_TILE_DESKTOP;
  const inner = Math.max(0, width - pad * 2);
  const cols = Math.max(2, Math.floor((inner + gap) / (min + gap)));
  const tileW = (inner - gap * (cols - 1)) / cols;
  const rowH = Math.round(tileW * 1.4 + TILE_EXTRA + (chipRow ? TILE_CHIP_ROW : 0) + (coarse ? 12 : 0) + gap);
  return { width, cols, tileW, gap, pad, rowH };
}

/** Virtualised tile grid: rows virtualised, columns from ResizeObserver, roving tabindex + arrow keys. */
export function CardGrid({ ids, dimWhenZero = true }: { ids: string[]; dimWhenZero?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasDecks = useStore((s) => s.user_decks.length > 0);
  const [layout, setLayout] = useState<Layout>(() => computeLayout(typeof window !== 'undefined' ? Math.min(window.innerWidth, 1200) : 1000, false, false));
  const [focusIdx, setFocusIdx] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const adjust = useStore((s) => s.adjust);
  const foilSticky = useStore((s) => s.ui.foilSticky);
  const hidePreview = usePreview((s) => s.hide);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const measure = (force = false) => {
      const w = el.clientWidth;
      if (w > 0) setLayout((l) => (l.width === w && !force ? l : computeLayout(w, coarse, hasDecks)));
    };
    measure(true); // the chip row appears/disappears with the first/last deck
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasDecks]);

  const rowCount = Math.ceil(ids.length / layout.cols);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => layout.rowH,
    overscan: 4,
    paddingStart: layout.pad,
    paddingEnd: layout.pad + 8,
  });

  // re-measure rows when geometry changes
  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.rowH, layout.cols]);

  // clamp focus when the list changes
  useEffect(() => {
    if (focusIdx >= ids.length) setFocusIdx(Math.max(0, ids.length - 1));
  }, [ids.length, focusIdx]);

  // focus the tile once it is rendered
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
      virtualizer.scrollToIndex(Math.floor(clamped / layout.cols), { align: 'auto' });
      // if already rendered, focus now
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${clamped}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        pendingFocus.current = null;
      }
    },
    [ids.length, layout.cols, virtualizer],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches('[data-index]')) return; // inside a stepper / input
    const cols = layout.cols;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(focusIdx + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(focusIdx - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(focusIdx + cols);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(focusIdx - cols);
        break;
      case 'PageDown':
        e.preventDefault();
        moveFocus(focusIdx + cols * 4);
        break;
      case 'PageUp':
        e.preventDefault();
        moveFocus(focusIdx - cols * 4);
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

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label="Cards"
      aria-rowcount={rowCount}
      aria-colcount={layout.cols}
      onKeyDown={onKeyDown}
      onScroll={() => hidePreview()}
      className="relative h-full w-full overflow-y-auto overscroll-contain outline-none"
      style={{ contain: 'strict' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((row) => {
          const start = row.index * layout.cols;
          const rowIds = ids.slice(start, start + layout.cols);
          return (
            <div
              key={row.key}
              role="row"
              data-row={row.index}
              style={{
                position: 'absolute',
                top: 0,
                left: layout.pad,
                right: layout.pad,
                transform: `translateY(${row.start}px)`,
                height: layout.rowH,
                display: 'grid',
                gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                gap: layout.gap,
                paddingBottom: layout.gap,
                boxSizing: 'border-box',
              }}
            >
              {rowIds.map((id, i) => {
                const index = start + i;
                return <CardTile key={id} cardId={id} index={index} tabIndex={index === focusIdx ? 0 : -1} onFocusTile={setFocusIdx} dimWhenZero={dimWhenZero} />;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
