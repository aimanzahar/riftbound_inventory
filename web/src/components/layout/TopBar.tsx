import { Funnel, LayoutGrid, List, Sparkles } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { activeFilterCount } from '../../store/filters.ts';
import { useRoute, pageTitle } from '../../lib/router.ts';
import { cx, ageShort, hoursSince } from '../../lib/format.ts';
import { SearchBox } from '../filters/SearchBox.tsx';
import { SortMenu } from '../filters/SortMenu.tsx';
import { useFilterSheet } from '../filters/FilterSheet.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { PresenceAvatars } from './PresenceAvatars.tsx';
import { ConnectionDot } from './ConnectionDot.tsx';
import { NavTabs, Brand } from './NavTabs.tsx';
import type { ViewMode } from '../../store/types.ts';

/**
 * ≥1024: one row — collection controls left, freshness/presence/connection right.
 * 640–1023: row 1 brand + tabs + status; row 2 collection controls.
 * <640: row 1 brand + status; row 2 sticky search + filter/sort/view.
 */
export function TopBar() {
  const route = useRoute();
  const isCollection = route.page === 'collection';
  return (
    <header className="relative z-30 shrink-0 border-b border-border bg-bg/85 backdrop-blur">
      {/* row 1 (hidden on lg where the rail carries the brand) */}
      <div className="flex h-12 items-center gap-3 px-3 sm:px-4 lg:hidden">
        <div className="flex items-center gap-2 lg:hidden">
          <Brand />
          <span className="text-[14px] font-semibold tracking-tight sm:hidden">{pageTitle(route.page)}</span>
        </div>
        <NavTabs className="hidden sm:flex" />
        <div className="ml-auto flex items-center gap-3">
          <Freshness className="hidden md:flex" />
          <PresenceAvatars />
          <ConnectionDot />
        </div>
      </div>
      {/* row 2 / lg single row */}
      <div className={cx('flex h-12 items-center gap-2 px-3 sm:px-4', !isCollection && 'hidden lg:flex')}>
        {isCollection ? <CollectionControls /> : <h1 className="text-[15px] font-semibold tracking-tight">{pageTitle(route.page)}</h1>}
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <Freshness />
          <PresenceAvatars />
          <ConnectionDot />
        </div>
      </div>
    </header>
  );
}

function CollectionControls() {
  const view = useStore((s) => s.ui.view);
  const setView = useStore((s) => s.setView);
  const foilSticky = useStore((s) => s.ui.foilSticky);
  const toggleFoil = useStore((s) => s.toggleFoilSticky);
  const filters = useStore((s) => s.ui.filters);
  const openSheet = useFilterSheet((s) => s.setOpen);
  const n = activeFilterCount(filters);
  return (
    <>
      <SearchBox className="min-w-0 flex-1 lg:w-[360px] lg:flex-none" />
      <button
        type="button"
        onClick={() => openSheet(true)}
        aria-label={`Filters${n ? ` (${n} active)` : ''}`}
        className={cx('relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted sm:hidden', n > 0 && 'border-accent/60 text-accent-strong')}
      >
        <Funnel className="size-4" aria-hidden />
        {n > 0 && <span className="tabular absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-[#0b0f17]">{n}</span>}
      </button>
      <Segmented<ViewMode>
        size="sm"
        ariaLabel="View"
        iconOnly
        value={view}
        onChange={setView}
        options={[
          { value: 'grid', label: 'Grid', icon: <LayoutGrid className="size-4" aria-hidden />, title: 'Grid (v)' },
          { value: 'list', label: 'List', icon: <List className="size-4" aria-hidden />, title: 'List (v)' },
        ]}
      />
      <SortMenu />
      <button
        type="button"
        onClick={toggleFoil}
        aria-pressed={foilSticky}
        title={foilSticky ? 'Steppers edit FOIL copies (f)' : 'Steppers edit normal copies — click for foil (f)'}
        className={cx(
          'hidden h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium transition-colors sm:inline-flex',
          foilSticky ? 'border-chaos/60 bg-chaos/15 text-[#e9d5ff]' : 'border-border bg-surface-2 text-muted hover:text-fg',
        )}
      >
        <Sparkles className="size-4" aria-hidden />
        Foil
      </button>
    </>
  );
}

/** "Prices 2h · FX 4.74 · Meta 2d" */
function Freshness({ className }: { className?: string }) {
  const pricesAt = useStore((s) => s.pricesFetchedAt);
  const fx = useStore((s) => s.fx);
  const metaAt = useStore((s) => s.jobs.find((j) => j.name === 'meta')?.last?.finished_at ?? null);
  const decks = useStore((s) => s.decks.length);
  const priceStale = hoursSince(pricesAt) > 36;
  const metaStale = hoursSince(metaAt) > 24 * 10;
  return (
    <div className={cx('tabular flex items-center gap-1.5 text-[11.5px] text-muted', className)} aria-label="Data freshness">
      <Chip label="Prices" value={pricesAt ? ageShort(pricesAt) : '—'} warn={Boolean(pricesAt) && priceStale} title={pricesAt ? `Prices fetched ${ageShort(pricesAt)} ago` : 'No prices yet'} />
      <Chip label="FX" value={fx ? fx.rate.toFixed(2) : '—'} warn={Boolean(fx?.stale)} title={fx ? `1 USD = ${fx.rate} MYR (${fx.source}, ${fx.day})` : 'No FX rate yet'} />
      <Chip label="Meta" value={metaAt ? ageShort(metaAt) : decks ? 'ok' : '—'} warn={Boolean(metaAt) && metaStale} title={metaAt ? `Meta decks refreshed ${ageShort(metaAt)} ago` : 'No meta decks yet'} />
    </div>
  );
}

function Chip({ label, value, warn, title }: { label: string; value: string; warn?: boolean; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-6 items-center gap-1 rounded-md border px-1.5', warn ? 'border-warning/40 text-warning' : 'border-border text-muted')}>
      <span className="text-faint">{label}</span>
      <span className={cx('font-semibold', warn ? 'text-warning' : 'text-fg/80')}>{value}</span>
    </span>
  );
}
