import { Check, TriangleAlert } from 'lucide-react';
import type { UserDeck } from '../../../../shared/types.ts';
import { cx, fmtInt, fmtUSD, relTime } from '../../lib/format.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { DeckCompletion } from '../meta/DeckCompletion.tsx';
import { useDeckModel } from './deckModel.ts';

/** One deck tile in the gallery: legend art, completion, rule status and cost to finish. */
export function DeckGalleryCard({ deck, onOpen }: { deck: UserDeck; onOpen: () => void }) {
  const model = useDeckModel(deck);
  if (!model) return null;
  const { completion, validation, legend } = model;
  const issues = validation.issues.length;

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${deck.name}, ${completion.owned} of ${completion.total} cards owned`}
        className={cx(
          'tile flex w-full flex-col gap-2.5 rounded-card border border-border bg-surface p-3 text-left outline-none transition-[border-color,box-shadow]',
          'hover:border-border-strong hover:shadow-[0_6px_24px_rgba(0,0,0,0.35)] focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40',
          deck.archived === 1 && 'opacity-60',
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="w-10 shrink-0">
            {legend ? <CardImage card={legend} kind="thumb" rounded="rounded" /> : <span className="block aspect-[5/7] w-full rounded border border-dashed border-border" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold tracking-tight" title={deck.name}>
              {deck.color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: deck.color }} aria-hidden />}
              <span className="truncate">{deck.name}</span>
            </h3>
            <p className="tabular truncate text-[11.5px] text-muted">
              {legend ? legend.name : 'No legend yet'} · {fmtInt(validation.totalCopies)} card{validation.totalCopies === 1 ? '' : 's'}
            </p>
            <p className="truncate text-[10.5px] text-faint">Updated {relTime(deck.updated_at)}</p>
          </div>
          {deck.archived === 1 && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted">Archived</span>}
        </div>

        <DeckCompletion owned={completion.owned} total={completion.total} />

        <div className="flex items-center justify-between gap-2 text-[11px]">
          {issues === 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-[#86efac]">
              <Check className="size-3.5" aria-hidden />
              Legal
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-[#fcd34d]" title={validation.issues.map((i) => i.text).join('\n')}>
              <TriangleAlert className="size-3.5" aria-hidden />
              {issues} to fix
            </span>
          )}
          <span className="tabular shrink-0 text-faint">
            {completion.missing === 0 ? (completion.total > 0 ? 'complete' : '') : `${fmtInt(completion.missing)} missing${completion.pricedMissing > 0 ? ` · ${fmtUSD(completion.costUsd)}` : ''}`}
          </span>
        </div>
      </button>
    </li>
  );
}
