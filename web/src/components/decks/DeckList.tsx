import type { DeckSection } from '../../../../shared/types.ts';
import { USER_SECTIONS } from '../../../../shared/deckRules.ts';
import { Minus, Plus } from 'lucide-react';
import { openCard } from '../../lib/router.ts';
import { cx } from '../../lib/format.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { DomainPips } from '../cards/DomainPips.tsx';
import { Badge } from '../ui/Badge.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { SECTION_LABELS, type DeckLine } from '../meta/metaModel.ts';
import { useCardHover } from '../meta/useCardHover.ts';
import type { DeckModel } from './deckModel.ts';
import { adjustLine, moveLine, useLineQty } from './deckStore.ts';

/** The decklist you edit: sections, ± steppers, owned/needed chips and a section move. */
export function DeckList({ model, className }: { model: DeckModel; className?: string }) {
  const { deck, completion, validation } = model;
  const bySection = new Map<DeckSection, DeckLine[]>();
  for (const l of completion.lines) {
    const arr = bySection.get(l.section);
    if (arr) arr.push(l);
    else bySection.set(l.section, [l]);
  }

  if (!deck.cards.length) {
    return (
      <div className={className}>
        <EmptyState
          compact
          title="No cards yet"
          description="Search the catalog on the left and press + to add cards. Anything you don’t own yet is still fair game — it shows as missing."
        />
      </div>
    );
  }

  return (
    <div className={cx('flex flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom))]', className)}>
      {USER_SECTIONS.map((sec) => {
        const lines = bySection.get(sec) ?? [];
        if (!lines.length) return null;
        const status = validation.sections.find((s) => s.section === sec);
        return (
          <section key={sec} aria-label={SECTION_LABELS[sec]}>
            <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface/95 px-2 py-1.5 backdrop-blur">
              <h3 className="text-[11px] font-semibold tracking-wider text-faint uppercase">{SECTION_LABELS[sec]}</h3>
              <span className={cx('tabular text-[11px]', status?.target === null ? 'text-faint' : status?.ok ? 'text-[#86efac]' : 'text-[#fcd34d]')}>
                {status?.count ?? 0}
                {status?.target !== null && status?.target !== undefined ? `/${status.target}` : ''}
              </span>
            </header>
            <ul className="flex flex-col">
              {lines.map((l) => (
                <DeckLineEditRow key={`${l.card_id}:${l.section}`} deckId={deck.id} line={l} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DeckLineEditRow({ deckId, line }: { deckId: string; line: DeckLine }) {
  const card = line.card;
  const hover = useCardHover(card);
  const qty = useLineQty(deckId, line.card_id, line.section);
  const name = card?.name ?? line.card_id;
  const tone = line.tone === 'complete' ? 'success' : line.tone === 'partial' ? 'warning' : 'danger';
  const statusWord = line.tone === 'complete' ? 'complete' : line.tone === 'partial' ? 'partial' : 'missing';

  return (
    <li className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-2">
      <button
        type="button"
        disabled={!card}
        onClick={() => card && openCard(card.id)}
        aria-label={`${name}, ${line.owned} of ${line.qty} owned, ${statusWord}. Open card details.`}
        onPointerEnter={hover.onPointerEnter}
        onPointerLeave={hover.onPointerLeave}
        onFocus={hover.onFocus}
        onBlur={hover.onBlur}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default"
      >
        <span className="w-7 shrink-0">{card ? <CardImage card={card} kind="thumb" rounded="rounded" /> : <span className="block aspect-[5/7] w-full rounded bg-surface-3" aria-hidden />}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-fg">{name}</span>
          <span className="tabular flex items-center gap-1.5 text-[10.5px] text-faint">
            <span>{line.card_id}</span>
            {card && card.domains.length > 0 && <DomainPips domains={card.domains} size="xs" />}
          </span>
        </span>
      </button>

      <Badge tone={tone} size="sm" className="min-w-9 shrink-0 justify-center" title={`${line.owned} of ${line.qty} owned — ${statusWord}`}>
        {line.owned}/{line.qty}
      </Badge>

      <select
        aria-label={`Section for ${name}`}
        value={line.section}
        onChange={(e) => void moveLine(deckId, line.card_id, line.section, e.target.value as DeckSection, name)}
        className="h-7 shrink-0 rounded-md border border-border bg-surface-2 px-1 text-[11px] text-muted focus:border-accent/60 focus:outline-none"
      >
        {USER_SECTIONS.map((s) => (
          <option key={s} value={s}>
            {SECTION_LABELS[s]}
          </option>
        ))}
      </select>

      <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-2">
        <button
          type="button"
          aria-label={`Remove one ${name}`}
          onClick={() => void adjustLine(deckId, line.card_id, line.section, -1, name)}
          className="inline-flex size-7 items-center justify-center rounded-l-md text-muted hover:bg-surface-3 hover:text-fg"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
        <span className="tabular w-6 text-center text-[12.5px] font-semibold text-fg">{qty}</span>
        <button
          type="button"
          aria-label={`Add one ${name}`}
          onClick={() => void adjustLine(deckId, line.card_id, line.section, 1, name)}
          className="inline-flex size-7 items-center justify-center rounded-r-md text-muted hover:bg-surface-3 hover:text-fg"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}
