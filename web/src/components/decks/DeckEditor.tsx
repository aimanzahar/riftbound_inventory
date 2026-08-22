import { useState } from 'react';
import { ArrowLeft, Settings2 } from 'lucide-react';
import type { UserDeck } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { useIsDesktop } from '../../lib/useMediaQuery.ts';
import { cx, fmtInt, fmtMYR, fmtUSD, usdToMyr } from '../../lib/format.ts';
import { Button } from '../ui/Button.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { CardImage } from '../cards/CardImage.tsx';
import { DeckCompletion } from '../meta/DeckCompletion.tsx';
import { useDeckModel } from './deckModel.ts';
import { DeckList } from './DeckList.tsx';
import { DeckPicker } from './DeckPicker.tsx';
import { DeckRules } from './DeckRules.tsx';
import { DeckSettingsDialog } from './DeckDialogs.tsx';

type Pane = 'add' | 'list';

/** Build one deck: catalog picker on the left, the list plus its rules on the right. */
export function DeckEditor({ deck, onBack }: { deck: UserDeck; onBack: () => void }) {
  const model = useDeckModel(deck);
  const fx = useStore((s) => s.fx);
  const isDesktop = useIsDesktop();
  const [pane, setPane] = useState<Pane>('list');
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!model) return null;
  const { completion, validation, legend } = model;
  const myr = usdToMyr(completion.costUsd, fx?.rate ?? null);

  const picker = <DeckPicker deck={deck} className="h-full" />;
  const list = (
    <div className="flex min-h-0 flex-col overflow-y-auto px-2">
      <DeckRules validation={validation} className="mx-2 mt-2" />
      <DeckList model={model} className="mt-2" />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b border-border px-4 pt-3 pb-3">
        <div className="flex items-start gap-2.5">
          <Button variant="ghost" size="icon-sm" aria-label="Back to all decks" onClick={onBack} className="-ml-1.5" leftIcon={<ArrowLeft className="size-4" />} />
          {legend && (
            <span className="w-8 shrink-0" title={legend.name}>
              <CardImage card={legend} kind="thumb" rounded="rounded" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="flex min-w-0 items-center gap-2 truncate text-[15px] font-semibold tracking-tight" title={deck.name}>
              {deck.color && <span className="size-2.5 shrink-0 rounded-full" style={{ background: deck.color }} aria-hidden />}
              <span className="truncate">{deck.name}</span>
              {deck.archived === 1 && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium text-muted">Archived</span>}
            </h2>
            <p className="tabular truncate text-[11.5px] text-faint">
              {fmtInt(validation.totalCopies)} card{validation.totalCopies === 1 ? '' : 's'}
              {legend ? ` · ${legend.name}` : ''}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Deck settings" onClick={() => setSettingsOpen(true)} leftIcon={<Settings2 className="size-4" />} />
        </div>

        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 p-3">
          <DeckCompletion owned={completion.owned} total={completion.total} size="md" />
          <p className="tabular text-[12px] leading-snug text-muted">
            {completion.total === 0 ? (
              <span className="text-faint">Add cards to see how much of this deck you can already build.</span>
            ) : completion.missing === 0 ? (
              <span className="font-medium text-[#86efac]">You own every card in this list.</span>
            ) : (
              <>
                <strong className="font-semibold text-fg">{fmtInt(completion.missing)} missing</strong>
                <span className="text-faint"> ({fmtInt(completion.distinctMissing)} distinct)</span>
                {completion.pricedMissing > 0 ? (
                  <>
                    {' · ≈ '}
                    <span className="font-medium text-fg">{fmtUSD(completion.costUsd)}</span>
                    {myr !== null ? <span className="text-fg/80"> ({fmtMYR(myr)})</span> : ''} to complete
                  </>
                ) : (
                  ' · no price data for the missing cards'
                )}
              </>
            )}
          </p>
        </div>

        {!isDesktop && (
          <Segmented
            ariaLabel="Deck builder pane"
            value={pane}
            onChange={setPane}
            className="self-start"
            size="sm"
            options={[
              { value: 'list', label: 'Decklist', count: validation.totalCopies },
              { value: 'add', label: 'Add cards' },
            ]}
          />
        )}
      </header>

      {isDesktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,2fr)_minmax(360px,3fr)] divide-x divide-border">
          {picker}
          {list}
        </div>
      ) : (
        <div className={cx('flex min-h-0 flex-1 flex-col', pane === 'add' ? '' : 'overflow-hidden')}>{pane === 'add' ? picker : list}</div>
      )}

      <DeckSettingsDialog deck={deck} open={settingsOpen} onClose={() => setSettingsOpen(false)} onDeleted={onBack} />
    </div>
  );
}
