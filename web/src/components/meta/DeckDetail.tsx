import { useMemo, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Layers } from 'lucide-react';
import type { Deck, DeckSection, DeckUnresolved } from '../../../../shared/types.ts';
import { useStore } from '../../store/store.ts';
import { canonicalOf } from '../../store/selectors.ts';
import { openCard } from '../../lib/router.ts';
import { useLongPress } from '../../lib/useLongPress.ts';
import { cx, fmtDate, fmtInt, fmtMYR, fmtUSD, usdToMyr } from '../../lib/format.ts';
import { CardImage } from '../cards/CardImage.tsx';
import { DomainPips } from '../cards/DomainPips.tsx';
import { usePreview } from '../cards/previewStore.ts';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { ExportDeckDialog } from '../decks/DeckDialogs.tsx';
import { openDeck } from '../decks/DeckChips.tsx';
import { DeckCompletion } from './DeckCompletion.tsx';
import { PlacementBadge, SourceLink } from './DeckCard.tsx';
import { useCardHover } from './useCardHover.ts';
import { SECTION_LABELS, SECTION_ORDER, tierLabel, useDeckCompletion, type DeckLine } from './metaModel.ts';

export interface DeckDetailProps {
  deck: Deck;
  /** shown as a back arrow (deck list ← detail on narrow layouts) */
  onBack?: () => void;
  /** classes for the back button (e.g. hide it on wide containers) */
  backClassName?: string;
  /** canonical id of the focus card — its rows are highlighted */
  focusCanon?: string | null;
  className?: string;
}

/** Full decklist by section with owned/needed chips, missing-only toggle, missing count + cost to complete, unresolved names greyed. */
export function DeckDetail({ deck, onBack, backClassName, focusCanon, className }: DeckDetailProps) {
  const info = useDeckCompletion(deck);
  const fx = useStore((s) => s.fx);
  const [missingOnly, setMissingOnly] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const bySection = useMemo(() => {
    const m = new Map<DeckSection, DeckLine[]>();
    if (info) for (const l of info.lines) (m.get(l.section) ?? m.set(l.section, []).get(l.section)!).push(l);
    return m;
  }, [info]);
  const unresolvedBySection = useMemo(() => {
    const m = new Map<DeckSection, DeckUnresolved[]>();
    for (const u of deck.unresolved) (m.get(u.section) ?? m.set(u.section, []).get(u.section)!).push(u);
    return m;
  }, [deck]);

  if (!info) return null;
  const incomplete = info.lines.filter((l) => l.tone !== 'complete').length;
  const myr = usdToMyr(info.costUsd, fx?.rate ?? null);
  const meta = [
    fmtDate(deck.event_date),
    deck.event_players !== null ? `${fmtInt(deck.event_players)} players` : null,
    deck.region,
    deck.event_tier ? tierLabel(deck.event_tier) : null,
    deck.format && deck.format !== 'constructed' ? deck.format : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <div className={cx('flex min-w-0 flex-col', className)} aria-label={`${deck.name} decklist`}>
      <header className="flex flex-col gap-3 border-b border-border px-4 pt-3 pb-4">
        <div className="flex items-start gap-2.5">
          {onBack && <Button variant="ghost" size="icon-sm" aria-label="Back to deck list" onClick={onBack} className={cx('-ml-1.5', backClassName)} leftIcon={<ArrowLeft className="size-4" />} />}
          <PlacementBadge placement={deck.placement} players={deck.event_players} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold tracking-tight" title={deck.name}>
              {deck.name}
            </h2>
            <p className="truncate text-[12.5px] text-muted" title={deck.event_name ?? undefined}>
              <span className="font-medium text-fg/90">{deck.player ?? 'Unknown player'}</span>
              {deck.event_name ? ` · ${deck.event_name}` : ''}
            </p>
            <p className="tabular truncate text-[11px] text-faint">{meta.join(' · ')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
          <DeckCompletion owned={info.owned} total={info.total} size="md" />
          <p className="tabular text-[12px] leading-snug text-muted">
            {info.missing === 0 ? (
              <span className="font-medium text-[#86efac]">Complete — you own every card in this list.</span>
            ) : (
              <>
                <strong className="font-semibold text-fg">
                  {fmtInt(info.missing)} missing
                </strong>
                <span className="text-faint"> ({fmtInt(info.distinctMissing)} distinct)</span>
                {info.pricedMissing > 0 ? (
                  <>
                    {' · ≈ '}
                    <span className="font-medium text-fg">{fmtUSD(info.costUsd)}</span>
                    {myr !== null ? <span className="text-fg/80"> ({fmtMYR(myr)})</span> : ''} to complete
                    {info.unpricedMissing > 0 ? ` · ${fmtInt(info.unpricedMissing)} unpriced` : ''}
                  </>
                ) : (
                  ' · no price data for the missing cards'
                )}
              </>
            )}
            {info.sideTotal > 0 && (
              <span className="text-faint">
                {' · sideboard '}
                {info.sideOwned}/{info.sideTotal}
              </span>
            )}
          </p>
          {deck.unresolved.length > 0 && (
            <p className="text-[11px] text-faint">
              {deck.unresolved.length} line{deck.unresolved.length === 1 ? '' : 's'} couldn’t be matched to the catalog and {deck.unresolved.length === 1 ? 'isn’t' : 'aren’t'} counted.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-pressed={missingOnly}
            onClick={() => setMissingOnly((v) => !v)}
            className={cx(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors pointer-coarse:h-9',
              missingOnly ? 'border-accent/60 bg-accent/15 text-accent-strong' : 'border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg',
            )}
          >
            {missingOnly ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            Missing only
            <span className={cx('tabular text-[11px]', missingOnly ? 'text-accent-strong/70' : 'text-faint')}>{incomplete}</span>
          </button>
          <SourceLink url={deck.source_url} className="pointer-coarse:h-9" />
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            title="Copy this list into a deck of your own"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-fg pointer-coarse:h-9"
          >
            <Layers className="size-3.5" aria-hidden />
            Export deck
          </button>
          <ExportDeckDialog deck={deck} open={exportOpen} onClose={() => setExportOpen(false)} onCreated={(d) => openDeck(d.id)} />
        </div>
      </header>

      <div className="flex flex-col gap-4 px-2 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {SECTION_ORDER.map((sec) => {
          const all = bySection.get(sec) ?? [];
          const lines = missingOnly ? all.filter((l) => l.tone !== 'complete') : all;
          const unresolved = unresolvedBySection.get(sec) ?? [];
          if (!lines.length && !unresolved.length) return null;
          let need = 0,
            have = 0;
          for (const l of all) {
            need += l.qty;
            have += l.owned;
          }
          return (
            <section key={sec} aria-label={SECTION_LABELS[sec]}>
              <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-surface/95 px-2 py-1.5 backdrop-blur">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {SECTION_LABELS[sec]}
                  {sec === 'side' && <span className="ml-1.5 font-normal normal-case tracking-normal">(not counted)</span>}
                </h3>
                <span className={cx('tabular text-[11px]', have >= need ? 'text-[#86efac]' : 'text-muted')}>
                  {have}/{need}
                </span>
              </header>
              <ul className="flex flex-col">
                {lines.map((l) => (
                  <DeckLineRow key={`${l.card_id}:${l.section}`} line={l} highlight={Boolean(focusCanon && l.card && canonicalOf(l.card) === focusCanon)} />
                ))}
                {unresolved.map((u, i) => (
                  <li key={`u-${i}`} className="flex min-h-9 items-center gap-2.5 rounded-lg px-2 py-1 text-[12.5px] text-faint italic" title="Not in the catalog — not counted towards completion">
                    <span className="w-7 shrink-0">
                      <span className="block aspect-[5/7] w-full rounded border border-dashed border-border" aria-hidden />
                    </span>
                    <span className="tabular w-7 shrink-0 text-right">×{u.qty}</span>
                    <span className="min-w-0 flex-1 truncate">{u.name ?? u.code ?? 'Unknown card'}</span>
                    <Badge tone="outline" size="xs">
                      unresolved
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {missingOnly && incomplete === 0 && <p className="px-2 py-6 text-center text-sm text-faint">Nothing missing — you own the whole list.</p>}
      </div>
    </div>
  );
}

function DeckLineRow({ line, highlight }: { line: DeckLine; highlight: boolean }) {
  const card = line.card;
  const hover = useCardHover(card);
  const openSheet = usePreview((s) => s.openSheet);
  const longPress = useLongPress(() => {
    if (card) openSheet(card.id);
  });
  const name = card?.name ?? line.card_id;
  const tone = line.tone === 'complete' ? 'success' : line.tone === 'partial' ? 'warning' : 'danger';
  const statusWord = line.tone === 'complete' ? 'complete' : line.tone === 'partial' ? 'partial' : 'missing';
  return (
    <li>
      <button
        type="button"
        disabled={!card}
        onClick={() => card && openCard(card.id)}
        aria-label={`${name}, ${line.owned} of ${line.qty} owned, ${statusWord}`}
        {...longPress}
        onPointerEnter={hover.onPointerEnter}
        onPointerLeave={(e) => {
          longPress.onPointerLeave(e);
          hover.onPointerLeave(e);
        }}
        onFocus={hover.onFocus}
        onBlur={hover.onBlur}
        className={cx(
          'tile flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left outline-none transition-colors pointer-coarse:min-h-11',
          'hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:cursor-default',
          highlight && 'bg-accent/10 ring-1 ring-inset ring-accent/30',
        )}
      >
        <span className="w-7 shrink-0">{card ? <CardImage card={card} kind="thumb" rounded="rounded" /> : <span className="block aspect-[5/7] w-full rounded bg-surface-3" aria-hidden />}</span>
        <span className="tabular w-7 shrink-0 text-right text-[12.5px] font-semibold text-muted">×{line.qty}</span>
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-[13px] font-medium', line.tone === 'missing' ? 'text-fg/80' : 'text-fg')}>{name}</span>
          <span className="tabular flex items-center gap-1.5 text-[10.5px] text-faint">
            <span>{line.card_id}</span>
            {card && card.domains.length > 0 && <DomainPips domains={card.domains} size="xs" />}
            {card?.type && <span className="truncate">· {card.type}</span>}
          </span>
        </span>
        <Badge tone={tone} size="sm" className="min-w-9 justify-center" title={`${line.owned} of ${line.qty} owned — ${statusWord}`}>
          {line.owned}/{line.qty}
        </Badge>
      </button>
    </li>
  );
}
