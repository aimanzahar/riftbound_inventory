import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { useCard, useCardUsage, useOwnedTotal, useQty } from '../../store/selectors.ts';
import { usePreview } from './previewStore.ts';
import { openCard } from '../../lib/router.ts';
import { preload } from '../../lib/images.ts';
import { cx } from '../../lib/format.ts';
import { CardImage } from './CardImage.tsx';
import { DomainPips, domainLabel, sortDomains } from './DomainPips.tsx';
import { PriceCell } from './PriceCell.tsx';
import { QtyStepper } from './QtyStepper.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { Badge } from '../ui/Badge.tsx';

const WIDTH = 320;
const GAP = 12;
const MARGIN = 8;

/** Mouse/keyboard hover preview (portal) + touch long-press sheet. Mounted once in App. */
export function HoverPreview() {
  const root = typeof document !== 'undefined' ? document.getElementById('preview-root') : null;
  return (
    <>
      {root && createPortal(<Pop />, root)}
      <TouchSheet />
    </>
  );
}

function Pop() {
  const cardId = usePreview((s) => s.cardId);
  const rect = usePreview((s) => s.rect);
  const hide = usePreview((s) => s.hide);
  const card = useCard(cardId);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: 'right' | 'left' } | null>(null);
  const [fullReady, setFullReady] = useState(false);

  // preload the full image while the tile is hovered
  useEffect(() => {
    setFullReady(false);
    if (!card) return;
    let alive = true;
    void preload(card, 'full').then((src) => {
      if (alive && src) setFullReady(true);
    });
    return () => {
      alive = false;
    };
  }, [card]);

  // hide on scroll / Esc / resize
  useEffect(() => {
    if (!cardId) return;
    const off = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('resize', off);
      window.removeEventListener('keydown', onKey);
    };
  }, [cardId, hide]);

  useLayoutEffect(() => {
    if (!rect || !ref.current) {
      setPos(null);
      return;
    }
    const h = ref.current.offsetHeight || 420;
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const fitsRight = rect.right + GAP + WIDTH <= vw - MARGIN;
    const side: 'right' | 'left' = fitsRight ? 'right' : 'left';
    let left = fitsRight ? rect.right + GAP : rect.left - GAP - WIDTH;
    if (left < MARGIN) left = Math.max(MARGIN, Math.min(vw - WIDTH - MARGIN, rect.right + GAP));
    let top = rect.top - 24;
    top = Math.max(MARGIN, Math.min(vh - h - MARGIN, top));
    setPos({ left, top, side });
  }, [rect, card, fullReady]);

  if (!card || !rect) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="preview-pop pointer-events-none fixed z-[70] overflow-hidden rounded-2xl border border-border bg-surface-2/95 shadow-pop backdrop-blur"
      style={{ width: WIDTH, left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
    >
      <PreviewBody cardId={card.id} fullReady={fullReady} />
    </div>
  );
}

function PreviewBody({ cardId, fullReady, interactive }: { cardId: string; fullReady: boolean; interactive?: boolean }) {
  const card = useCard(cardId);
  const tip = useStore((s) => s.tips.get(cardId));
  const usage = useCardUsage(card);
  const owned = useOwnedTotal(cardId);
  const foil = useQty(cardId, 'foil');
  if (!card) return null;
  const statline = [
    card.type,
    card.supertype && card.supertype !== card.type ? card.supertype : null,
    card.domains.length ? sortDomains(card.domains).map(domainLabel).join('/') : null,
    card.energy !== null ? `${card.energy}⚡` : null,
    card.might !== null ? `${card.might} might` : null,
    card.power !== null ? `${card.power} power` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col">
      <div className="relative bg-bg">
        {/* thumb stays underneath until the full image has loaded → crossfade */}
        <CardImage card={card} kind="thumb" className="rounded-none" rounded="" />
        {fullReady && (
          <div className="fade-up absolute inset-0">
            <CardImage card={card} kind="full" eager className="rounded-none" rounded="" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-[15px] font-semibold leading-tight tracking-tight">{card.name}</h3>
            <span className="tabular shrink-0 text-[11px] text-muted">{card.id}</span>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <DomainPips domains={card.domains} size="xs" />
            {statline.join(' · ')}
          </p>
        </div>
        <p className={cx('text-[13px] leading-snug', tip ? 'text-fg/90' : 'italic text-faint')}>
          {tip ? tip.text : 'No tip yet'}
          {interactive && (
            <button type="button" onClick={() => openCard(cardId)} className="ml-1.5 inline-flex align-middle text-accent hover:text-accent-strong" aria-label="Edit tip">
              <Pencil className="size-3.5" />
            </button>
          )}
          {!interactive && <Pencil className="ml-1.5 inline size-3 align-middle text-faint" aria-hidden />}
        </p>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-xs">
          <span className="tabular text-muted">
            Owned <span className={cx('font-semibold', owned > 0 ? 'text-fg' : 'text-faint')}>{owned}</span>
            {foil > 0 && <span className="foil-text ml-1 font-semibold">✦{foil}</span>}
          </span>
          <PriceCell cardId={cardId} inline size="sm" />
        </div>
        {usage && usage.decks > 0 ? (
          <Badge tone="accent" size="sm" className="self-start">
            Used in {usage.decks} meta deck{usage.decks === 1 ? '' : 's'}
          </Badge>
        ) : (
          <span className="text-[11px] text-faint">Not in current meta decks</span>
        )}
      </div>
    </div>
  );
}

/** Touch: long-press on a tile opens this sheet with image, tip and both steppers. */
function TouchSheet() {
  const cardId = usePreview((s) => s.sheetCardId);
  const close = usePreview((s) => s.closeSheet);
  const card = useCard(cardId);
  const [fullReady, setFullReady] = useState(false);
  useEffect(() => {
    setFullReady(false);
    if (!card) return;
    let alive = true;
    void preload(card, 'full').then((src) => {
      if (alive && src) setFullReady(true);
    });
    return () => {
      alive = false;
    };
  }, [card]);
  return (
    <Sheet open={Boolean(cardId && card)} onClose={close} title={card?.name ?? ''} bodyClassName="px-0 sm:px-0">
      {card && (
        <div className="flex flex-col">
          <div className="mx-auto w-[min(70vw,260px)] overflow-hidden rounded-xl">
            <div className="relative">
              <CardImage card={card} kind="thumb" />
              {fullReady && (
                <div className="fade-up absolute inset-0">
                  <CardImage card={card} kind="full" eager />
                </div>
              )}
            </div>
          </div>
          <div className="px-4 pt-3 sm:px-5">
            <PreviewBodyText cardId={card.id} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 px-4 sm:px-5">
            <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface-2 p-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Normal</span>
              <QtyStepper cardId={card.id} finish="normal" size="lg" label={card.name} isolate={false} />
            </div>
            <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface-2 p-3">
              <span className="foil-text text-[11px] font-semibold uppercase tracking-wide">✦ Foil</span>
              <QtyStepper cardId={card.id} finish="foil" size="lg" label={card.name} isolate={false} />
            </div>
          </div>
          <div className="px-4 pt-3 pb-1 sm:px-5">
            <button
              type="button"
              onClick={() => {
                close();
                openCard(card.id);
              }}
              className="h-11 w-full rounded-xl border border-border bg-surface-2 text-sm font-medium text-fg hover:bg-surface-3"
            >
              Open details
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function PreviewBodyText({ cardId }: { cardId: string }) {
  const card = useCard(cardId);
  const tip = useStore((s) => s.tips.get(cardId));
  const usage = useCardUsage(card);
  if (!card) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
        <span className="tabular">{card.id}</span>
        <span>·</span>
        <DomainPips domains={card.domains} size="xs" />
        {card.type}
        {card.energy !== null && <span>· {card.energy}⚡</span>}
        {card.might !== null && <span>· {card.might} might</span>}
      </p>
      <p className={cx('text-sm leading-snug', tip ? 'text-fg/90' : 'italic text-faint')}>{tip ? tip.text : 'No tip yet'}</p>
      <div className="flex items-center justify-between text-xs">
        <PriceCell cardId={cardId} inline size="md" />
        {usage && usage.decks > 0 && (
          <Badge tone="accent" size="sm">
            {usage.decks} meta deck{usage.decks === 1 ? '' : 's'}
          </Badge>
        )}
      </div>
    </div>
  );
}
