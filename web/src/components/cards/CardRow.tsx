import { memo, useCallback, useEffect, useRef, type CSSProperties, type FocusEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Swords } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { useCard, useCardUsage, useQty } from '../../store/selectors.ts';
import { navigate, openCard } from '../../lib/router.ts';
import { useLongPress } from '../../lib/useLongPress.ts';
import { preload } from '../../lib/images.ts';
import { cx } from '../../lib/format.ts';
import { usePreview, rectOf } from './previewStore.ts';
import { CardImage } from './CardImage.tsx';
import { DomainPips } from './DomainPips.tsx';
import { PriceCell } from './PriceCell.tsx';
import { QtyStepper } from './QtyStepper.tsx';
import { RARITY_COLORS } from './CardTile.tsx';

export interface CardRowProps {
  cardId: string;
  index: number;
  tabIndex: number;
  onFocusTile: (index: number) => void;
  style?: CSSProperties;
}

/** 56 px list row with both steppers. Same hover/focus/long-press behaviour as the tile. */
function CardRowInner({ cardId, index, tabIndex, onFocusTile, style }: CardRowProps) {
  const card = useCard(cardId);
  const normal = useQty(cardId, 'normal');
  const foil = useQty(cardId, 'foil');
  const pulse = useStore((s) => s.pulses.get(cardId));
  const usage = useCardUsage(card);
  const show = usePreview((s) => s.show);
  const hide = usePreview((s) => s.hide);
  const openSheet = usePreview((s) => s.openSheet);
  const ref = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pulse) return;
    el.style.setProperty('--pulse-color', pulse.color);
    el.classList.remove('pulse-remote');
    void el.offsetWidth;
    el.classList.add('pulse-remote');
    const t = window.setTimeout(() => el.classList.remove('pulse-remote'), 1300);
    return () => window.clearTimeout(t);
  }, [pulse]);

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  useEffect(() => clearHover, [clearHover]);

  const onPointerEnter = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || !card) return;
    void preload(card, 'full');
    clearHover();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const img = ref.current?.querySelector('[data-thumb]') ?? ref.current;
      if (img) show(cardId, rectOf(img), 'mouse');
    }, 120);
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearHover();
    hide(cardId);
  };
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (e.target !== ref.current) return;
    onFocusTile(index);
    if (ref.current.matches(':focus-visible')) show(cardId, rectOf(ref.current.querySelector('[data-thumb]') ?? ref.current), 'focus');
  };
  const longPress = useLongPress(() => openSheet(cardId));

  if (!card) return <div style={style} className="h-14 border-b border-border" />;
  const total = normal + foil;

  return (
    <div
      ref={ref}
      style={style}
      tabIndex={tabIndex}
      data-index={index}
      data-card={cardId}
      role="row"
      aria-label={`${card.name}, ${card.id}, ${total} owned`}
      onClick={() => {
        clearHover();
        hide(cardId);
        openCard(cardId);
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          hide(cardId);
          openCard(cardId);
        }
      }}
      {...longPress}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(e) => {
        longPress.onPointerLeave(e);
        onPointerLeave(e);
      }}
      onFocus={onFocus}
      onBlur={(e) => e.target === ref.current && hide(cardId)}
      className={cx(
        'tile group flex h-14 cursor-pointer items-center gap-3 border-b border-border px-3 outline-none transition-colors hover:bg-surface focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40',
        total === 0 && 'text-muted',
      )}
    >
      <div data-thumb className="w-8 shrink-0">
        <CardImage card={card} kind="thumb" rounded="rounded" className={cx(total === 0 && 'opacity-50')} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div className="flex items-center gap-2">
          <span className={cx('truncate text-[13.5px] font-semibold tracking-tight', total > 0 ? 'text-fg' : 'text-muted')}>{card.name}</span>
          {usage && usage.decks > 0 && (
            <button
              type="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                clearHover();
                hide(cardId);
                navigate({ page: 'meta', cardId, query: null });
              }}
              className="inline-flex shrink-0 items-center gap-0.5 rounded px-0.5 text-[10.5px] font-semibold text-accent-strong hover:bg-accent/20 hover:text-fg"
              title={`Used in ${usage.decks} meta deck${usage.decks === 1 ? '' : 's'} — see them`}
              aria-label={`Used in ${usage.decks} meta deck${usage.decks === 1 ? '' : 's'}; open meta decks using this card`}
            >
              <Swords className="size-3" aria-hidden />
              {usage.decks}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="tabular">{card.id}</span>
          <span className="size-1.5 rounded-full" style={{ background: RARITY_COLORS[card.rarity ?? ''] ?? '#6b7280' }} title={card.rarity ?? undefined} />
          <DomainPips domains={card.domains} size="xs" />
          <span className="hidden truncate sm:inline">
            · {card.type}
            {card.energy !== null ? ` · ${card.energy}⚡` : ''}
          </span>
        </div>
      </div>
      <PriceCell cardId={cardId} size="sm" className="hidden w-[88px] shrink-0 items-end text-right sm:flex" />
      <div className="flex shrink-0 items-center gap-1.5">
        <QtyStepper cardId={cardId} finish="normal" size="sm" label={card.name} />
        <QtyStepper cardId={cardId} finish="foil" size="sm" label={card.name} showFinish className="hidden xs:inline-flex sm:inline-flex" />
      </div>
    </div>
  );
}

export const CardRow = memo(CardRowInner);
