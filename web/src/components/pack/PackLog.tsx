import { memo, useCallback, useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CircleAlert, LoaderCircle, Undo2 } from 'lucide-react';
import { useCard } from '../../store/selectors.ts';
import { openCard } from '../../lib/router.ts';
import { preload } from '../../lib/images.ts';
import { ageShort, cx, fmtInt } from '../../lib/format.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { usePreview, rectOf } from '../cards/previewStore.ts';
import { Badge } from '../ui/Badge.tsx';
import { isLive, printingLabel, usePack, type LogEntry } from './packStore.ts';

const ROW_H = 52;

/** Virtualised session log, newest first: thumb · name ✦ · ×qty · new total · per-row undo. */
export function PackLog({ className }: { className?: string }) {
  const entries = usePack((s) => s.entries);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hidePreview = usePreview((s) => s.hide);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  // a new entry lands at the top — keep it in view
  const count = entries.length;
  useEffect(() => {
    if (count && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [count]);

  const live = entries.reduce((n, e) => n + (isLive(e) ? 1 : 0), 0);

  return (
    <section className={cx('flex min-h-0 flex-col', className)} aria-label="Session log">
      <div className="flex h-8 shrink-0 items-center gap-2 px-4 text-[11.5px] text-faint sm:px-6">
        <span className="font-medium uppercase tracking-wide">Log</span>
        {count > 0 && (
          <span className="tabular">
            {fmtInt(live)} entr{live === 1 ? 'y' : 'ies'}
            {count !== live ? ` · ${fmtInt(count - live)} undone` : ''}
          </span>
        )}
        <span className="ml-auto hidden sm:inline">newest first</span>
      </div>
      <div ref={scrollRef} role="list" aria-label="Entries" onScroll={() => hidePreview()} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border" style={{ contain: 'strict' }}>
        {count === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-faint sm:px-6">Cards you add in this session show up here.</p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const e = entries[v.index];
              return <LogRow key={e.id} entry={e} ordinal={count - v.index} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${v.start}px)` }} />;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function LogRowInner({ entry, ordinal, style }: { entry: LogEntry; ordinal: number; style: CSSProperties }) {
  const card = useCard(entry.cardId);
  const undoEntry = usePack((s) => s.undoEntry);
  const show = usePreview((s) => s.show);
  const hide = usePreview((s) => s.hide);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const onPointerEnter = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || !card) return;
    void preload(card, 'full');
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const thumb = ref.current?.querySelector('[data-thumb]') ?? ref.current;
      if (thumb) show(entry.cardId, rectOf(thumb), 'mouse');
    }, 120);
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    clear();
    hide(entry.cardId);
  };

  if (!card) return <div style={style} className="border-b border-border" />;
  const gone = entry.status === 'undone' || entry.status === 'failed';
  const canUndo = entry.status === 'pending' || entry.status === 'done';
  const label = `${card.name}${entry.finish === 'foil' ? ' foil' : ''} ×${entry.qty}`;

  return (
    <div
      ref={ref}
      style={style}
      role="listitem"
      tabIndex={0}
      aria-label={`${ordinal}: ${label}, now ${entry.total}${entry.status === 'undone' ? ', undone' : entry.status === 'failed' ? ', not saved' : ''}`}
      onClick={() => {
        clear();
        hide(entry.cardId);
        openCard(entry.cardId);
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          openCard(entry.cardId);
        }
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={(e) => {
        if (e.target === ref.current && ref.current.matches(':focus-visible')) show(entry.cardId, rectOf(ref.current.querySelector('[data-thumb]') ?? ref.current), 'focus');
      }}
      onBlur={(e) => e.target === ref.current && hide(entry.cardId)}
      className={cx(
        'tile group flex cursor-pointer items-center gap-3 border-b border-border px-4 outline-none transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 sm:px-6',
        gone && 'opacity-55',
      )}
    >
      <span className="tabular w-6 shrink-0 text-right text-[11px] text-faint" aria-hidden>
        {ordinal}
      </span>
      <div data-thumb className="w-7 shrink-0">
        <CardImage card={card} kind="thumb" rounded="rounded" className={cx(gone && 'saturate-50')} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <span className={cx('truncate text-[13.5px] font-semibold tracking-tight', gone ? 'text-muted line-through' : 'text-fg')}>
          {card.name}
          {entry.finish === 'foil' && (
            <span className="foil-text ml-1.5 text-[12px]" title="Foil">
              ✦
            </span>
          )}
        </span>
        <span className="tabular flex items-center gap-1.5 text-[11px] text-muted">
          <span>{card.id}</span>
          {card.variant_kind && <span className="text-faint">· {printingLabel(card)}</span>}
          <span className="hidden text-faint sm:inline">· {ageShort(new Date(entry.at).toISOString())}</span>
        </span>
      </div>
      <span className={cx('tabular shrink-0 text-[13.5px] font-semibold', entry.qty > 1 ? 'text-accent-strong' : 'text-fg', gone && 'line-through')} title="Copies added">
        ×{entry.qty}
      </span>
      <span className="tabular hidden w-12 shrink-0 text-right text-[12px] text-muted xs:inline sm:inline" title="Copies owned after this entry">
        → {entry.total}
      </span>
      <span className="flex w-7 shrink-0 items-center justify-center">
        {entry.status === 'pending' || entry.status === 'undoing' ? (
          <LoaderCircle className="size-3.5 animate-spin text-muted" aria-label={entry.status === 'pending' ? 'Saving' : 'Undoing'} />
        ) : entry.status === 'failed' ? (
          <CircleAlert className="size-4 text-danger" aria-label="Not saved" />
        ) : entry.status === 'undone' ? (
          <Badge tone="neutral" size="xs">
            undone
          </Badge>
        ) : null}
      </span>
      <button
        type="button"
        aria-label={`Undo ${label}`}
        title="Undo this entry"
        disabled={!canUndo}
        onClick={(e) => {
          e.stopPropagation();
          void undoEntry(entry.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-25 pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <Undo2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

const LogRow = memo(LogRowInner);
