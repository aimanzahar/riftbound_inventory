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

export const RARITY_COLORS: Record<string, string> = {
  Common: '#9aa4b8',
  Uncommon: '#34d399',
  Rare: '#60a5fa',
  Epic: '#c084fc',
  Showcase: '#fbbf24',
  Promo: '#f472b6',
};

export interface CardTileProps {
  cardId: string;
  index: number;
  tabIndex: number;
  onFocusTile: (index: number) => void;
  style?: CSSProperties;
  /** the filter context: under "All" a qty-0 tile is dimmed */
  dimWhenZero?: boolean;
}

const HOVER_DELAY = 120;

function CardTileInner({ cardId, index, tabIndex, onFocusTile, style, dimWhenZero = true }: CardTileProps) {
  const card = useCard(cardId);
  const normal = useQty(cardId, 'normal');
  const foil = useQty(cardId, 'foil');
  const foilSticky = useStore((s) => s.ui.foilSticky);
  const pulse = useStore((s) => s.pulses.get(cardId));
  const usage = useCardUsage(card);
  const show = usePreview((s) => s.show);
  const hide = usePreview((s) => s.hide);
  const openSheet = usePreview((s) => s.openSheet);
  const ref = useRef<HTMLElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const pulseRef = useRef<HTMLElement>(null);

  // remote-change pulse: restart the animation in the actor's colour
  useEffect(() => {
    const el = pulseRef.current;
    if (!el || !pulse) return;
    el.style.setProperty('--pulse-color', pulse.color);
    el.classList.remove('pulse-remote');
    // force reflow to restart
    void el.offsetWidth;
    el.classList.add('pulse-remote');
    const t = window.setTimeout(() => el.classList.remove('pulse-remote'), 1300);
    return () => window.clearTimeout(t);
  }, [pulse]);

  const clearHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);
  useEffect(() => clearHover, [clearHover]);

  const onPointerEnter = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || !card) return;
    void preload(card, 'full');
    clearHover();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      if (ref.current) show(cardId, rectOf(ref.current), 'mouse');
    }, HOVER_DELAY);
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    clearHover();
    hide(cardId);
  };
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    if (e.target !== ref.current) return;
    onFocusTile(index);
    if (ref.current.matches(':focus-visible')) show(cardId, rectOf(ref.current), 'focus');
  };
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (e.target === ref.current) hide(cardId);
  };

  const longPress = useLongPress(() => {
    clearHover();
    openSheet(cardId);
  });

  if (!card) return <article style={style} className="tile rounded-card border border-border bg-surface" />;

  const total = normal + foil;
  const dim = dimWhenZero && total === 0;
  const stepFinish = foilSticky ? 'foil' : 'normal';
  const rarityColor = RARITY_COLORS[card.rarity ?? ''] ?? '#6b7280';

  return (
    <article
      ref={ref}
      style={style}
      tabIndex={tabIndex}
      data-index={index}
      data-card={cardId}
      data-dim={dim ? 'true' : 'false'}
      aria-label={`${card.name}, ${card.id}, ${total} owned`}
      onClick={() => {
        clearHover();
        hide(cardId);
        openCard(cardId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target !== e.currentTarget) return;
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
      onBlur={onBlur}
      className={cx(
        'tile group relative flex cursor-pointer flex-col gap-1.5 rounded-card border bg-surface p-2 text-left outline-none transition-[border-color,box-shadow] duration-150',
        'hover:border-border-strong hover:shadow-[0_6px_24px_rgba(0,0,0,0.35)] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
        'border-border',
      )}
    >
      <div ref={pulseRef as React.RefObject<HTMLDivElement>} className="relative rounded-lg">
        <CardImage card={card} kind="thumb" />
        {/* qty badge */}
        {(normal > 0 || foil > 0) && (
          <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
            {normal > 0 && <span className="tabular rounded-md bg-bg/85 px-1.5 py-0.5 text-[11px] font-bold text-fg shadow backdrop-blur">×{normal}</span>}
            {foil > 0 && (
              <span className="tabular rounded-md bg-bg/85 px-1.5 py-0.5 text-[11px] font-bold shadow backdrop-blur" title="Foil copies">
                <span className="foil-text">✦{foil}</span>
              </span>
            )}
          </div>
        )}
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
            className="absolute top-1.5 left-1.5 inline-flex items-center gap-0.5 rounded-md bg-bg/85 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-strong shadow backdrop-blur hover:bg-accent/30 hover:text-fg"
            title={`Used in ${usage.decks} meta deck${usage.decks === 1 ? '' : 's'} — see them`}
            aria-label={`Used in ${usage.decks} meta deck${usage.decks === 1 ? '' : 's'}; open meta decks using this card`}
          >
            <Swords className="size-3" aria-hidden />
            {usage.decks}
          </button>
        )}
        {card.banned === 1 && <span className="absolute bottom-1.5 left-1.5 rounded-md bg-danger/85 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">BANNED</span>}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <h3 className={cx('truncate text-[13px] font-semibold leading-[17px] tracking-tight', dim ? 'text-muted' : 'text-fg')} title={card.name}>
          {card.name}
        </h3>
        <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted">
          <span className="tabular">{card.id}</span>
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: rarityColor }} title={card.rarity ?? undefined} aria-label={card.rarity ?? undefined} />
          <DomainPips domains={card.domains} size="xs" />
          {card.variant_kind && (
            <span className="ml-auto truncate text-[10px] uppercase tracking-wide text-faint" title={card.variant_kind.replace('_', ' ')}>
              {card.variant_kind === 'alt_art' ? 'ALT' : card.variant_kind === 'signature' ? 'SIG' : card.variant_kind === 'showcase' ? 'SC' : card.variant_kind === 'overnumbered' ? 'SC' : 'RP'}
            </span>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-1.5">
        <PriceCell cardId={cardId} size="sm" inline className="min-w-0 px-0.5" />
        <QtyStepper cardId={cardId} finish={stepFinish} size="sm" label={card.name} showFinish className={cx('w-full justify-between', foilSticky && 'border-chaos/50')} />
      </div>
    </article>
  );
}

export const CardTile = memo(CardTileInner);
