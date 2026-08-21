import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { Card, PurchaseLine, PurchaseLineStatus } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { invKey } from '../../store/types.ts';
import { cx } from '../../lib/format.ts';
import { preload } from '../../lib/images.ts';
import { useLongPress } from '../../lib/useLongPress.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { PriceCell } from '../cards/PriceCell.tsx';
import { usePreview, rectOf } from '../cards/previewStore.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';

export type ContentsSortKey = 'status' | 'card' | 'in_product' | 'owned_now' | 'owned_after' | 'price';
type Dir = 'asc' | 'desc';

const STATUS_LABEL: Record<PurchaseLineStatus, string> = { owned: 'Owned', partial: 'Partial', new: 'New' };
const STATUS_TONE: Record<PurchaseLineStatus, BadgeTone> = { owned: 'danger', partial: 'warning', new: 'success' };
const STATUS_ROW: Record<PurchaseLineStatus, string> = {
  owned: 'border-l-danger bg-danger/8',
  partial: 'border-l-warning bg-warning/8',
  new: 'border-l-success bg-success/6',
};
const STATUS_RANK: Record<PurchaseLineStatus, number> = { owned: 0, partial: 1, new: 2 };

const COLS = 'grid-cols-[minmax(0,1fr)_52px_52px_56px] sm:grid-cols-[minmax(0,1fr)_64px_64px_64px_108px]';
const ROW_H = 46;
const VIRTUAL_FROM = 100;
const HOVER_DELAY = 120;

export interface ContentsTableProps {
  lines: PurchaseLine[];
  /** click on a card name (the dialog closes itself and opens the drawer) */
  onOpenCard?: (cardId: string) => void;
  className?: string;
}

/**
 * Product contents with owned/partial/new colouring, sortable headers, hover preview on rows
 * (same previewStore as the grid) and virtualisation above 100 rows.
 */
export function ContentsTable({ lines, onOpenCard, className }: ContentsTableProps) {
  const cardsById = useStore((s) => s.cardsById);
  const prices = useStore((s) => s.prices);
  const [sort, setSort] = useState<{ key: ContentsSortKey; dir: Dir }>({ key: 'status', dir: 'asc' });

  const sorted = useMemo(() => {
    const arr = [...lines];
    const name = (l: PurchaseLine) => cardsById.get(l.card_id)?.name ?? l.card_id;
    const price = (l: PurchaseLine) => prices.get(invKey(l.card_id, 'normal'))?.usd_market ?? prices.get(invKey(l.card_id, l.finish))?.usd_market ?? -1;
    const byId = (a: PurchaseLine, b: PurchaseLine) => a.card_id.localeCompare(b.card_id);
    const mul = sort.dir === 'asc' ? 1 : -1;
    switch (sort.key) {
      case 'card':
        arr.sort((a, b) => mul * (name(a).localeCompare(name(b)) || byId(a, b)));
        break;
      case 'in_product':
        arr.sort((a, b) => mul * (a.in_product - b.in_product) || byId(a, b));
        break;
      case 'owned_now':
        arr.sort((a, b) => mul * (a.owned_now - b.owned_now) || byId(a, b));
        break;
      case 'owned_after':
        arr.sort((a, b) => mul * (a.owned_after - b.owned_after) || byId(a, b));
        break;
      case 'price':
        arr.sort((a, b) => mul * (price(a) - price(b)) || byId(a, b));
        break;
      default:
        arr.sort((a, b) => mul * (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || byId(a, b));
    }
    return arr;
  }, [lines, sort, cardsById, prices]);

  const toggle = (key: ContentsSortKey) =>
    setSort((s) => {
      if (s.key === key) return { key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
      // numeric columns start descending (biggest first), text/status ascending
      return { key, dir: key === 'card' || key === 'status' ? 'asc' : 'desc' };
    });

  const virtual = sorted.length > VIRTUAL_FROM;

  // roving tabindex: one tab stop for the whole table, ↑/↓/Home/End move between rows
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusIdx, setFocusIdx] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const scrollToRow = useRef<((i: number) => void) | null>(null);
  useEffect(() => {
    if (focusIdx >= sorted.length) setFocusIdx(Math.max(0, sorted.length - 1));
  }, [sorted.length, focusIdx]);
  const moveFocus = useCallback(
    (next: number) => {
      if (!sorted.length) return;
      const i = Math.max(0, Math.min(sorted.length - 1, next));
      setFocusIdx(i);
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-index="${i}"]`);
      if (el) el.focus({ preventScroll: false });
      else {
        pendingFocus.current = i;
        scrollToRow.current?.(i);
      }
    },
    [sorted.length],
  );
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (!t.matches('[data-index]')) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(focusIdx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(focusIdx - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        e.preventDefault();
        moveFocus(sorted.length - 1);
        break;
    }
  };
  const rowProps = { focusIdx, onFocusRow: setFocusIdx, onOpenCard };

  return (
    <div ref={rootRef} role="table" aria-label="Product contents" aria-rowcount={sorted.length + 1} onKeyDown={onKeyDown} className={cx('overflow-hidden rounded-xl border border-border', className)}>
      <div role="row" className={cx('grid items-center gap-2 border-b border-border bg-surface-2 py-1.5 pr-2 pl-[11px] text-[10.5px] font-semibold tracking-wider text-faint uppercase', COLS)}>
        <SortHeader label="Card" k="card" sort={sort} onToggle={toggle} className="justify-start" />
        <SortHeader label="In product" short="In" k="in_product" sort={sort} onToggle={toggle} />
        <SortHeader label="You own" short="Own" k="owned_now" sort={sort} onToggle={toggle} />
        <SortHeader label="After" k="owned_after" sort={sort} onToggle={toggle} />
        <SortHeader label="Price" k="price" sort={sort} onToggle={toggle} className="hidden sm:flex" />
      </div>
      {virtual ? <VirtualRows lines={sorted} cardsById={cardsById} pendingFocus={pendingFocus} scrollToRow={scrollToRow} {...rowProps} /> : <PlainRows lines={sorted} cardsById={cardsById} {...rowProps} />}
    </div>
  );
}

interface RowsProps {
  lines: PurchaseLine[];
  cardsById: Map<string, Card>;
  focusIdx: number;
  onFocusRow: (i: number) => void;
  onOpenCard?: (id: string) => void;
}

function SortHeader({ label, short, k, sort, onToggle, className }: { label: string; short?: string; k: ContentsSortKey; sort: { key: ContentsSortKey; dir: Dir }; onToggle: (k: ContentsSortKey) => void; className?: string }) {
  const active = sort.key === k;
  return (
    <div role="columnheader" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cx('flex min-w-0 items-center justify-end', className)}>
      <button type="button" onClick={() => onToggle(k)} className={cx('inline-flex h-6 max-w-full items-center gap-0.5 rounded px-1 hover:text-fg', active ? 'text-fg' : 'text-faint')} title={`Sort by ${label.toLowerCase()}`}>
        <span className="truncate">
          {short ? (
            <>
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </>
          ) : (
            label
          )}
        </span>
        {active ? sort.dir === 'asc' ? <ArrowUp className="size-3 shrink-0" aria-hidden /> : <ArrowDown className="size-3 shrink-0" aria-hidden /> : <ChevronsUpDown className="size-3 shrink-0 opacity-60" aria-hidden />}
      </button>
    </div>
  );
}

function PlainRows({ lines, cardsById, focusIdx, onFocusRow, onOpenCard }: RowsProps) {
  return (
    <div role="rowgroup">
      {lines.map((l, i) => (
        <ContentsRow key={`${l.card_id}:${l.finish}`} line={l} card={cardsById.get(l.card_id)} index={i} tabIndex={i === focusIdx ? 0 : -1} onFocusRow={onFocusRow} last={i === lines.length - 1} onOpenCard={onOpenCard} />
      ))}
    </div>
  );
}

function VirtualRows({ lines, cardsById, focusIdx, onFocusRow, onOpenCard, pendingFocus, scrollToRow }: RowsProps & { pendingFocus: React.MutableRefObject<number | null>; scrollToRow: React.MutableRefObject<((i: number) => void) | null> }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hide = usePreview((s) => s.hide);
  const v = useVirtualizer({ count: lines.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 8 });
  useEffect(() => {
    scrollToRow.current = (i) => v.scrollToIndex(i, { align: 'auto' });
    return () => {
      scrollToRow.current = null;
    };
  }, [v, scrollToRow]);
  // focus a row that was scrolled into view for keyboard navigation
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${pendingFocus.current}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });
  return (
    <div ref={scrollRef} role="rowgroup" onScroll={() => hide()} className="max-h-[min(50dvh,520px)] overflow-y-auto overscroll-contain">
      <div style={{ height: v.getTotalSize(), position: 'relative', width: '100%' }}>
        {v.getVirtualItems().map((it) => {
          const l = lines[it.index];
          return (
            <ContentsRow
              key={`${l.card_id}:${l.finish}`}
              line={l}
              card={cardsById.get(l.card_id)}
              index={it.index}
              tabIndex={it.index === focusIdx ? 0 : -1}
              onFocusRow={onFocusRow}
              last={it.index === lines.length - 1}
              onOpenCard={onOpenCard}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${it.start}px)` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ContentsRowInner({ line, card, index, tabIndex, onFocusRow, last, onOpenCard, style }: { line: PurchaseLine; card: Card | undefined; index: number; tabIndex: number; onFocusRow: (i: number) => void; last: boolean; onOpenCard?: (id: string) => void; style?: CSSProperties }) {
  const show = usePreview((s) => s.show);
  const hide = usePreview((s) => s.hide);
  const openSheet = usePreview((s) => s.openSheet);
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const id = line.card_id;

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  useEffect(() => clearHover, [clearHover]);

  const anchor = () => ref.current?.querySelector('[data-thumb]') ?? ref.current;
  const onPointerEnter = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || !card) return;
    void preload(card, 'full');
    clearHover();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const a = anchor();
      if (a) show(id, rectOf(a), 'mouse');
    }, HOVER_DELAY);
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearHover();
    hide(id);
  };
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (e.target !== ref.current) return;
    onFocusRow(index);
    if (!card) return;
    if (ref.current.matches(':focus-visible')) {
      const a = anchor();
      if (a) show(id, rectOf(a), 'focus');
    }
  };
  const longPress = useLongPress(() => {
    clearHover();
    if (card) openSheet(id);
  });

  const name = card?.name ?? id;
  const foil = line.finish === 'foil';

  return (
    <div
      ref={ref}
      role="row"
      tabIndex={tabIndex}
      data-index={index}
      aria-rowindex={index + 2}
      aria-label={`${name}, ${line.in_product} in product, you own ${line.owned_now}, after ${line.owned_after}, ${STATUS_LABEL[line.status].toLowerCase()}`}
      style={style}
      {...longPress}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(e) => {
        longPress.onPointerLeave(e);
        onPointerLeave(e);
      }}
      onFocus={onFocus}
      onBlur={(e) => e.target === ref.current && hide(id)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && onOpenCard) {
          e.preventDefault();
          hide(id);
          onOpenCard(id);
        }
      }}
      className={cx(
        'tile grid items-center gap-2 border-l-2 py-1 pr-2 pl-2 text-[12.5px] outline-none transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset',
        COLS,
        STATUS_ROW[line.status],
        !last && 'border-b border-b-border',
        !style && 'min-h-[46px]',
      )}
    >
      <div role="cell" className="flex min-w-0 items-center gap-2">
        <div data-thumb className="w-6 shrink-0">
          {card ? <CardImage card={card} kind="thumb" rounded="rounded-[3px]" /> : <div className="aspect-[5/7] w-full rounded-[3px] bg-surface-3" aria-hidden />}
        </div>
        <div className="flex min-w-0 flex-col leading-tight">
          {onOpenCard && card ? (
            <button
              type="button"
              onClick={() => {
                hide(id);
                onOpenCard(id);
              }}
              className="truncate text-left font-semibold text-fg hover:underline underline-offset-2 focus-visible:underline"
              title={`Open ${name}`}
            >
              {name}
            </button>
          ) : (
            <span className="truncate font-semibold text-fg">{name}</span>
          )}
          <span className="tabular flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
            <span className="truncate">{id}</span>
            {foil && <span className="foil-text shrink-0 font-semibold">✦ foil</span>}
            <Badge tone={STATUS_TONE[line.status]} size="xs" className="shrink-0">
              {STATUS_LABEL[line.status]}
            </Badge>
          </span>
        </div>
      </div>
      <div role="cell" className="tabular text-right font-semibold text-fg">
        ×{line.in_product}
      </div>
      <div role="cell" className={cx('tabular text-right', line.owned_now > 0 ? 'text-fg' : 'text-faint')}>
        {line.owned_now}
      </div>
      <div role="cell" className="tabular flex items-center justify-end gap-1 text-right text-fg">
        {line.owned_after}
        {line.beyond_playset > 0 && (
          <span className="text-[10.5px] font-semibold text-warning" title={`${line.beyond_playset} cop${line.beyond_playset === 1 ? 'y' : 'ies'} beyond your playset`}>
            +{line.beyond_playset}
          </span>
        )}
      </div>
      <div role="cell" className="hidden justify-end sm:flex">
        <PriceCell cardId={id} finish={line.finish} size="xs" inline />
      </div>
    </div>
  );
}

const ContentsRow = memo(ContentsRowInner);
