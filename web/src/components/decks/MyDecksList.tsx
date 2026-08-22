import { useState } from 'react';
import { Plus, TriangleAlert } from 'lucide-react';
import type { Card, DeckSection } from '../../../../shared/types.ts';
import { USER_SECTIONS, sectionForCard } from '../../../../shared/deckRules.ts';
import { cx } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { SECTION_LABELS } from '../meta/metaModel.ts';
import { copiesIn, useCommitment, useUserDecks } from './deckModel.ts';
import { adjustLine } from './deckStore.ts';
import { commitmentTitle, openDeck } from './DeckChips.tsx';
import { NewDeckDialog } from './DeckDialogs.tsx';

/** Drawer panel: which of your decks use this card, how committed you are, and a way to add it to one. */
export function MyDecksList({ card }: { card: Card }) {
  const decks = useUserDecks();
  const commitment = useCommitment(card);
  const [section, setSection] = useState<DeckSection>(() => sectionForCard(card));
  const [target, setTarget] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const { uses, committed, owned, over } = commitment;

  if (!decks.length) {
    return (
      <>
        <p className="text-sm text-faint">
          You have no decks yet.{' '}
          <button type="button" onClick={() => setNewOpen(true)} className="font-medium text-accent underline-offset-2 hover:underline">
            Build one
          </button>{' '}
          and the cards in it get tagged here and in the collection.
        </p>
        <NewDeckDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={(d) => openDeck(d.id)} />
      </>
    );
  }

  const chosen = target || decks[0].id;
  const add = () => void adjustLine(chosen, card.id, section, 1, card.name);

  return (
    <div className="flex flex-col gap-3">
      {uses.length === 0 ? (
        <p className="text-sm text-faint">Not in any of your decks yet.</p>
      ) : (
        <>
          <p className={cx('text-sm', over ? 'text-[#fcd34d]' : 'text-muted')} title={commitmentTitle(commitment)}>
            {over && <TriangleAlert className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
            <strong className="font-semibold text-fg">{committed}</strong> committed across {uses.length} deck{uses.length === 1 ? '' : 's'} · you own{' '}
            <strong className={cx('font-semibold', over ? 'text-[#fcd34d]' : 'text-fg')}>{owned}</strong>
            {over && <span className="text-faint"> — {committed - owned} short if you build them all at once</span>}
          </p>
          <ul className="flex flex-col gap-1">
            {uses.map((u) => (
              <li key={u.deckId}>
                <button
                  type="button"
                  onClick={() => openDeck(u.deckId)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-1.5 py-1 text-left text-sm hover:bg-surface-2"
                  title={`Open ${u.deckName}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: u.color ?? '#6b7280' }} aria-hidden />
                    <span className="truncate font-medium">{u.deckName}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted">×{u.copies}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        <select
          aria-label="Deck to add this card to"
          value={chosen}
          onChange={(e) => setTarget(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-[12.5px] text-fg focus:border-accent/60 focus:outline-none"
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {copiesIn(d, card.id) > 0 ? ` (×${copiesIn(d, card.id)})` : ''}
            </option>
          ))}
        </select>
        <select
          aria-label="Section to add this card to"
          value={section}
          onChange={(e) => setSection(e.target.value as DeckSection)}
          className="h-8 shrink-0 rounded-md border border-border bg-surface-2 px-2 text-[12.5px] text-fg focus:border-accent/60 focus:outline-none"
        >
          {USER_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {SECTION_LABELS[s]}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={add} leftIcon={<Plus className="size-3.5" />} title={`Add ${card.name} to the selected deck`}>
          Add
        </Button>
      </div>
    </div>
  );
}
