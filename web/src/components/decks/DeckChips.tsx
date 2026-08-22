import { TriangleAlert } from 'lucide-react';
import type { Card } from '../../../../shared/types.ts';
import { navigate } from '../../lib/router.ts';
import { cx } from '../../lib/format.ts';
import { useCommitment, type Commitment, type DeckUse } from './deckModel.ts';

/** Open the builder on one deck. */
export function openDeck(deckId: string): void {
  navigate({ page: 'decks', cardId: null, query: { deck: deckId } });
}

export function commitmentTitle(c: Commitment): string {
  return `${c.committed} cop${c.committed === 1 ? 'y' : 'ies'} committed across ${c.uses.length} deck${c.uses.length === 1 ? '' : 's'} · you own ${c.owned}`;
}

export interface DeckChipsProps {
  card: Card | undefined;
  /** deck chips to name before collapsing the rest into “+N” */
  max?: number;
  /** run before navigating (tiles use it to drop the hover preview) */
  onNavigate?: () => void;
  className?: string;
}

function Chip({ use, onNavigate }: { use: DeckUse; onNavigate?: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.();
        openDeck(use.deckId);
      }}
      title={`${use.deckName} — ${use.copies} cop${use.copies === 1 ? 'y' : 'ies'}. Open the deck.`}
      className="inline-flex h-[18px] min-w-0 shrink items-center gap-1 rounded-full border border-border bg-surface-2 pr-1.5 pl-1 text-[10px] font-medium text-muted hover:border-border-strong hover:text-fg"
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: use.color ?? 'var(--color-faint, #6b7280)' }} aria-hidden />
      <span className="truncate">{use.deckName}</span>
      <span className="tabular shrink-0 text-faint">×{use.copies}</span>
    </button>
  );
}

/**
 * “This card is in these decks of yours.” Keyed canonically, so a deck built on an alt-art printing
 * still tags the base card. Silent when the card is in none.
 */
export function DeckChips({ card, max = 2, onNavigate, className }: DeckChipsProps) {
  const commitment = useCommitment(card);
  const { uses, over } = commitment;
  if (!uses.length) return null;
  const shown = uses.slice(0, max);
  const rest = uses.length - shown.length;
  return (
    <div className={cx('flex min-w-0 items-center gap-1 overflow-hidden', className)}>
      {over && (
        <span className="inline-flex shrink-0" title={commitmentTitle(commitment)}>
          <TriangleAlert className="size-3 text-[#fcd34d]" aria-hidden />
        </span>
      )}
      {shown.map((u) => (
        <Chip key={u.deckId} use={u} onNavigate={onNavigate} />
      ))}
      {rest > 0 && (
        <span className="tabular shrink-0 text-[10px] font-medium text-faint" title={uses.slice(max).map((u) => `${u.deckName} ×${u.copies}`).join(', ')}>
          +{rest}
        </span>
      )}
      <span className="sr-only">
        {over ? `Over-committed: ${commitmentTitle(commitment)}. ` : ''}
        In your decks: {uses.map((u) => `${u.deckName} ${u.copies} copies`).join(', ')}
      </span>
    </div>
  );
}
