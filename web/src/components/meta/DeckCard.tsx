import { ExternalLink } from 'lucide-react';
import type { Deck } from '../../../../shared/types.ts';
import { cx, fmtDate, fmtInt } from '../../lib/format.ts';
import { Badge } from '../ui/Badge.tsx';
import { DeckCompletion } from './DeckCompletion.tsx';
import { isWebUrl, sourceLabel, useDeckCompletion } from './metaModel.ts';

function placementClasses(p: number | null): string {
  if (p === null) return 'border-border bg-surface-2 text-faint';
  if (p === 1) return 'border-warning/40 bg-warning/15 text-[#fcd34d]';
  if (p <= 4) return 'border-accent/40 bg-accent/15 text-accent-strong';
  if (p <= 8) return 'border-border-strong bg-surface-3 text-fg';
  return 'border-border bg-surface-2 text-muted';
}

/** “#3 of 101” tile — colour by tier, number always shown. */
export function PlacementBadge({ placement, players, size = 'md', className }: { placement: number | null; players: number | null; size?: 'md' | 'lg'; className?: string }) {
  const label = placement === null ? 'Placement unknown' : `Placed ${placement}${players ? ` of ${fmtInt(players)}` : ''}`;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cx(
        'tabular inline-flex shrink-0 flex-col items-center justify-center rounded-lg border px-1.5 leading-none',
        size === 'lg' ? 'h-12 min-w-12' : 'h-10 min-w-10',
        placementClasses(placement),
        className,
      )}
    >
      <span className={cx('font-bold', size === 'lg' ? 'text-[15px]' : 'text-[13px]')}>{placement === null ? '—' : `#${placement}`}</span>
      {players !== null && <span className="mt-0.5 text-[9.5px] opacity-75">of {fmtInt(players)}</span>}
    </span>
  );
}

/** Small external link to the deck's source (riftools / WeChat / event locator). */
export function SourceLink({ url, className, label }: { url: string; className?: string; label?: string }) {
  const where = sourceLabel(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      aria-label={`Open source list (${where})`}
      title={isWebUrl(url) ? url : `${url}\n(not a web link — opens in ${where} if installed)`}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-fg',
        className,
      )}
    >
      <ExternalLink className="size-3.5" aria-hidden />
      {label ?? 'Open source'}
      <span className="text-faint">· {where}</span>
    </a>
  );
}

export interface DeckCardProps {
  deck: Deck;
  selected: boolean;
  /** this is the archetype's representative list */
  representative: boolean;
  onSelect: () => void;
}

/** One tournament list in the archetype's deck list: placement, player, event, date, players, completion, source. */
export function DeckCard({ deck, selected, representative, onSelect }: DeckCardProps) {
  const c = useDeckCompletion(deck);
  return (
    <li className="relative list-none">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${deck.player ?? 'Unknown player'}, placed ${deck.placement ?? '?'} at ${deck.event_name ?? deck.source}${c ? `, you own ${c.owned} of ${c.total} cards` : ''}`}
        className={cx(
          'flex w-full min-w-0 flex-col gap-2 rounded-xl border p-3 pr-11 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
          selected ? 'border-accent/60 bg-accent/10' : 'border-border bg-surface hover:border-border-strong hover:bg-surface-2',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <PlacementBadge placement={deck.placement} players={deck.event_players} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold tracking-tight text-fg">{deck.player ?? 'Unknown player'}</span>
              {representative && (
                <Badge tone="accent" size="xs" title="Representative list: this legend’s most recent top-8 finish">
                  Rep.
                </Badge>
              )}
            </div>
            <div className="truncate text-[11.5px] text-muted" title={deck.event_name ?? undefined}>
              {deck.event_name ?? deck.source}
            </div>
            <div className="tabular flex flex-wrap items-center gap-x-1.5 text-[11px] text-faint">
              <span>{fmtDate(deck.event_date)}</span>
              {deck.event_players !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span>{fmtInt(deck.event_players)} players</span>
                </>
              )}
              {deck.region && (
                <>
                  <span aria-hidden>·</span>
                  <span>{deck.region}</span>
                </>
              )}
            </div>
          </div>
        </div>
        {c && <DeckCompletion owned={c.owned} total={c.total} />}
      </button>
      <a
        href={deck.source_url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`Open source list (${sourceLabel(deck.source_url)})`}
        title={deck.source_url}
        className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-surface-3 hover:text-fg pointer-coarse:size-9"
      >
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </li>
  );
}
