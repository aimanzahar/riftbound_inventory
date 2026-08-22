import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Plus, Search, X } from 'lucide-react';
import type { Card, UserDeck } from '../../../../shared/types.ts';
import { sectionForCard } from '../../../../shared/deckRules.ts';
import { searchCards } from '../../../../shared/search.ts';
import { useStore } from '../../store/store.ts';
import { canonicalOf, isToken, useCards, useOwnedByCanonical } from '../../store/selectors.ts';
import { cx } from '../../lib/format.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { DomainPips } from '../cards/DomainPips.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { SECTION_LABELS } from '../meta/metaModel.ts';
import { useCardHover } from '../meta/useCardHover.ts';
import { copiesIn } from './deckModel.ts';
import { adjustLine } from './deckStore.ts';

const ROW_H = 52;
type Scope = 'owned' | 'all';

/** Left pane: pick cards out of the catalog and press + to add them to the open deck. */
export function DeckPicker({ deck, className }: { deck: UserDeck; className?: string }) {
  const cards = useCards();
  const sets = useStore((s) => s.sets);
  const inventory = useStore((s) => s.inventory);
  const ownedByCanonical = useOwnedByCanonical();
  const [scope, setScope] = useState<Scope>('owned');
  const [q, setQ] = useState('');
  const deferredQ = useDeferredValue(q);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ownedIds = useMemo(() => {
    const s = new Set<string>();
    for (const row of inventory.values()) if (row.qty > 0) s.add(row.card_id);
    return s;
  }, [inventory]);

  const results = useMemo(() => {
    const setOrder = new Map(sets.map((s, i) => [s.code, i]));
    const pool = cards.filter((c) => !isToken(c) && (scope === 'all' || ownedIds.has(c.id)));
    const query = deferredQ.trim();
    if (query) return searchCards(query, pool, ownedIds, 400);
    return [...pool].sort(
      (x, y) => (setOrder.get(x.set_code) ?? 999) - (setOrder.get(y.set_code) ?? 999) || x.number_int - y.number_int || x.number.localeCompare(y.number),
    );
  }, [cards, sets, scope, ownedIds, deferredQ]);

  const virtualizer = useVirtualizer({ count: results.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 8 });

  return (
    <div className={cx('flex min-h-0 min-w-0 flex-col', className)}>
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && q) {
                e.stopPropagation();
                setQ('');
              }
            }}
            placeholder="Search name or number…"
            aria-label="Search cards to add"
            className="h-9 w-full rounded-lg border border-border bg-surface-2 pr-8 pl-8 text-[14px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-faint hover:text-fg">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Segmented
            size="sm"
            ariaLabel="Which cards to show"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'owned', label: 'Owned', title: 'Only cards you own' },
              { value: 'all', label: 'All cards', title: 'The whole catalog — unowned cards show as missing in the deck' },
            ]}
          />
          <span className="tabular shrink-0 text-[11px] text-faint">{results.length} cards</span>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-faint">
            {scope === 'owned' ? 'Nothing owned matches. Switch to “All cards” to plan with cards you don’t have yet.' : 'No cards match that search.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const card = results[v.index];
              return (
                <div key={card.id} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${v.start}px)` }}>
                  <PickRow card={card} deck={deck} owned={ownedByCanonical.get(canonicalOf(card)) ?? 0} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PickRow({ card, deck, owned }: { card: Card; deck: UserDeck; owned: number }) {
  const hover = useCardHover(card);
  const inDeck = copiesIn(deck, card.id);
  const section = sectionForCard(card);
  const add = () => void adjustLine(deck.id, card.id, section, 1, card.name);

  return (
    <div
      className="flex h-full items-center gap-2.5 px-3 hover:bg-surface-2"
      onPointerEnter={hover.onPointerEnter}
      onPointerLeave={hover.onPointerLeave}
    >
      <span className="w-7 shrink-0">
        <CardImage card={card} kind="thumb" rounded="rounded" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-fg" title={card.name}>
          {card.name}
        </p>
        <p className="tabular flex items-center gap-1.5 truncate text-[10.5px] text-faint">
          <span>{card.id}</span>
          {card.domains.length > 0 && <DomainPips domains={card.domains} size="xs" />}
          <span className="truncate">· {SECTION_LABELS[section]}</span>
        </p>
      </div>
      <span className={cx('tabular shrink-0 text-[11px]', owned > 0 ? 'text-muted' : 'text-faint')} title={`${owned} owned across every printing and finish`}>
        {owned > 0 ? `${owned} owned` : 'not owned'}
      </span>
      {inDeck > 0 && (
        <span className="tabular shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent-strong" title={`${inDeck} in this deck`}>
          ×{inDeck}
        </span>
      )}
      <button
        type="button"
        onClick={add}
        onFocus={hover.onFocus}
        onBlur={hover.onBlur}
        aria-label={`Add ${card.name} to ${SECTION_LABELS[section]}`}
        title={`Add to ${SECTION_LABELS[section]}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted hover:border-accent/60 hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
