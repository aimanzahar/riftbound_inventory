import { useEffect, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, ScanLine, Undo2 } from 'lucide-react';
import type { Card } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { useCard, useQty } from '../../store/selectors.ts';
import { cx } from '../../lib/format.ts';
import { preload } from '../../lib/images.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { PriceCell } from '../cards/PriceCell.tsx';
import { DomainPips } from '../cards/DomainPips.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Kbd, Keys } from '../ui/Kbd.tsx';
import { printingLabel, usePack, type LogEntry } from './packStore.ts';

/** Right panel: the card that was just added slides up with "now ×N" and its price. */
export function PackFlash({ className }: { className?: string }) {
  const lastId = usePack((s) => s.lastId);
  const flashN = usePack((s) => s.flashN);
  const entry = usePack((s) => (s.lastId === null ? null : (s.entries.find((e) => e.id === s.lastId) ?? null)));
  return (
    <aside className={cx('flex min-h-0 flex-col overflow-hidden bg-surface/40', className)} aria-label="Last card added" aria-live="polite">
      {entry && lastId !== null ? <FlashBody key={flashN} entry={entry} /> : <EmptyFlash />}
    </aside>
  );
}

function FlashBody({ entry }: { entry: LogEntry }) {
  const card = useCard(entry.cardId);
  const qty = useQty(entry.cardId, entry.finish);
  if (!card) return null;
  return (
    <div className="flex h-full min-h-0 flex-row items-stretch gap-4 overflow-y-auto p-4 lg:flex-col lg:gap-5 lg:p-5" style={{ animation: 'slide-up 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both' }}>
      <div className="relative w-[88px] shrink-0 sm:w-[110px] lg:mx-auto lg:w-full lg:max-w-[300px]">
        <FlashImage card={card} />
        <span className={cx('tabular absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold shadow backdrop-blur lg:top-2.5 lg:left-2.5 lg:text-sm', entry.finish === 'foil' ? 'bg-bg/85' : 'bg-accent text-[#0b0f17]')}>
          {entry.finish === 'foil' ? <span className="foil-text">✦ +{entry.qty}</span> : `+${entry.qty}`}
        </span>
        {entry.wasNew && entry.status !== 'undone' && (
          <span className="absolute top-1.5 right-1.5 rounded-md bg-success/90 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#052e16] shadow lg:top-2.5 lg:right-2.5 lg:text-[11px]">NEW</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 lg:flex-none lg:gap-2">
        <h2 className="truncate text-[17px] font-semibold tracking-tight text-fg lg:text-xl" title={card.name}>
          {card.name}
        </h2>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted lg:text-[13px]">
          <span className="tabular">{card.id}</span>
          {card.variant_kind && (
            <>
              <span className="text-faint">·</span>
              <span>{printingLabel(card)}</span>
            </>
          )}
          {card.type && (
            <>
              <span className="text-faint">·</span>
              <span>{card.type}</span>
            </>
          )}
          <DomainPips domains={card.domains} size="xs" />
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 lg:mt-3">
          <span className={cx('tabular text-3xl font-bold leading-none tracking-tight lg:text-5xl', entry.status === 'undone' ? 'text-faint line-through' : entry.finish === 'foil' ? 'foil-text' : 'text-fg')}>
            {entry.finish === 'foil' && <span className="mr-1 text-[0.6em] align-[0.15em]">✦</span>}
            now ×{qty}
          </span>
          <PriceCell cardId={card.id} finish={entry.finish} size="lg" className="items-end text-right" />
        </div>
        <StatusLine entry={entry} />
      </div>
    </div>
  );
}

/** thumb first (instant, usually cached), full image crossfades in once preloaded */
function FlashImage({ card }: { card: Card }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    setFull(false);
    let alive = true;
    void preload(card, 'full').then((src) => {
      if (alive && src) setFull(true);
    });
    return () => {
      alive = false;
    };
  }, [card]);
  return (
    <div className="relative overflow-hidden rounded-xl shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-border">
      <CardImage card={card} kind="thumb" rounded="rounded-xl" />
      {full && (
        <div className="fade-up absolute inset-0">
          <CardImage card={card} kind="full" eager rounded="rounded-xl" />
        </div>
      )}
    </div>
  );
}

function StatusLine({ entry }: { entry: LogEntry }) {
  const undoEntry = usePack((s) => s.undoEntry);
  const connection = useStore((s) => s.connection);
  switch (entry.status) {
    case 'pending':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted" aria-live="off">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          {connection === 'live' ? 'Saving…' : 'Saving when back online…'}
        </p>
      );
    case 'done':
      return (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1 text-[#86efac]">
            <Check className="size-3.5" aria-hidden />
            Saved
          </span>
          <span className="text-faint">·</span>
          <button type="button" onClick={() => void undoEntry(entry.id)} className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-accent hover:bg-accent/10 hover:text-accent-strong pointer-coarse:h-11" aria-label="Undo this entry">
            <Undo2 className="size-3.5" aria-hidden />
            Undo <Kbd className="ml-0.5 hidden sm:inline-flex">⌫</Kbd>
          </button>
        </p>
      );
    case 'undoing':
      return (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          Undoing…
        </p>
      );
    case 'undone':
      return (
        <p className="text-xs text-muted">
          <Badge tone="neutral" size="sm">
            Undone
          </Badge>
        </p>
      );
    case 'failed':
      return (
        <p className="flex items-center gap-1.5 text-xs text-[#fca5a5]">
          <CircleAlert className="size-3.5" aria-hidden />
          Not saved — see the error toast
        </p>
      );
  }
}

function EmptyFlash() {
  const rows: Array<[string, string]> = [
    ['45', 'OGN-045 ×1'],
    ['45f', 'foil'],
    ['45x3', 'three copies'],
    ['7a', 'alt art (045a, 303s…)'],
    ['sfd12', 'another set'],
    ['r1 · t2 · sp1', 'rune · token · special'],
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-5 py-6 text-center lg:py-10">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border bg-surface-2 text-muted" aria-hidden>
        <ScanLine className="size-6" />
      </div>
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-fg">Open a pack, type the numbers</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">Each Enter adds a card. The card you just added shows up here.</p>
      </div>
      <dl className="tabular grid w-full max-w-xs grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-left text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-mono font-semibold text-fg">{k}</dt>
            <dd className="text-muted">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="hidden flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11.5px] text-faint sm:flex">
        <span className="inline-flex items-center gap-1">
          <Keys keys={['Tab']} /> next set
        </span>
        <span className="inline-flex items-center gap-1">
          <Keys keys={['F']} /> foil
        </span>
        <span className="inline-flex items-center gap-1">
          <Keys keys={['⌫']} /> undo last
        </span>
        <span className="inline-flex items-center gap-1">
          <Keys keys={['1', '2']} /> pick a printing
        </span>
      </div>
    </div>
  );
}
