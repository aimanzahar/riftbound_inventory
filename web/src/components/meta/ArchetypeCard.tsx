import type { Card } from '../../../../shared/types.ts';
import { cx, fmtInt } from '../../lib/format.ts';
import type { ImageKind } from '../../lib/images.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { DomainPips } from '../cards/DomainPips.tsx';
import { Badge } from '../ui/Badge.tsx';
import { DeckCompletion } from './DeckCompletion.tsx';
import { useCardHover } from './useCardHover.ts';
import type { Archetype } from './metaModel.ts';

/** Legend art through CardImage (same fallback chain + hover preview); domain placeholder when the legend card is unknown. */
export function LegendArt({ card, name, className, rounded = 'rounded-lg', kind = 'thumb' }: { card: Card | undefined; name: string; className?: string; rounded?: string; kind?: ImageKind }) {
  const hover = useCardHover(card);
  const img = card ?? { id: '', name, image_url: null, domains: [] as string[], orientation: 'portrait' as const };
  return (
    <div className={cx('shrink-0', className)} onPointerEnter={hover.onPointerEnter} onPointerLeave={hover.onPointerLeave}>
      <CardImage card={img} kind={kind} rounded={rounded} />
    </div>
  );
}

export function fmtShare(share: number): string {
  const pct = share * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

export function fmtPlacement(p: number | null): string {
  return p === null ? '—' : `#${p}`;
}

export interface ArchetypeCardProps {
  a: Archetype;
  /** name of the focus card (`?card=`) when the page is narrowed to decks using it */
  focusName: string | null;
  onOpen: () => void;
}

/** One legend: art, domains, champions, #decks / share / placements, and how much of the representative list you own. */
export function ArchetypeCard({ a, focusName, onOpen }: ArchetypeCardProps) {
  const shown = a.shown.length;
  const all = a.decks.length;
  const narrowed = shown !== all;
  const c = a.completion;
  const champs = a.champions.slice(0, 2).join(' / ') + (a.champions.length > 2 ? ` +${a.champions.length - 2}` : '');
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${a.legendName}: ${shown} deck${shown === 1 ? '' : 's'}, ${fmtShare(a.share)} share, you own ${c.owned} of ${c.total} cards of the representative list`}
      className={cx(
        'group flex w-full min-w-0 gap-3 rounded-xl border border-border bg-surface p-3 text-left outline-none transition-[border-color,background-color,box-shadow] duration-150',
        'hover:border-border-strong hover:bg-surface-2 hover:shadow-[0_6px_24px_rgba(0,0,0,0.3)] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
      )}
    >
      <LegendArt card={a.legendCard} name={a.legendName} className="w-16" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold leading-tight tracking-tight text-fg" title={a.legendName}>
              {a.legendName}
            </h3>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted">
              {a.legendCard && a.legendCard.domains.length > 0 && <DomainPips domains={a.legendCard.domains} size="xs" />}
              {champs && (
                <span className="truncate" title={a.champions.join(', ')}>
                  {champs}
                </span>
              )}
            </div>
          </div>
          <Badge tone="accent" size="sm" title={`${all} of the ${narrowed ? 'window’s' : 'window’s'} decks play this legend`}>
            {fmtShare(a.share)}
          </Badge>
        </div>
        <div className="tabular flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-muted">
          <span>
            <strong className="font-semibold text-fg">{fmtInt(shown)}</strong>
            {narrowed ? ` of ${fmtInt(all)}` : ''} deck{(narrowed ? all : shown) === 1 ? '' : 's'}
          </span>
          <span aria-hidden>·</span>
          <span title="Best placement">best {fmtPlacement(a.best)}</span>
          <span aria-hidden>·</span>
          <span title="Average placement">avg {a.avg === null ? '—' : a.avg.toFixed(1)}</span>
          <span aria-hidden>·</span>
          <span>{a.top8} top-8</span>
        </div>
        {a.cardUse && focusName && (
          <div className="truncate text-[11.5px] text-accent-strong" title={`${focusName} appears in ${a.cardUse.decks} of this legend’s ${all} decks, ${a.cardUse.avgCopies.toFixed(1)} copies on average`}>
            Plays <span className="font-medium">{focusName}</span> in {a.cardUse.decks}/{all} · avg {a.cardUse.avgCopies.toFixed(1)}×
          </div>
        )}
        <DeckCompletion owned={c.owned} total={c.total} className="mt-auto pt-0.5" />
      </div>
    </button>
  );
}
