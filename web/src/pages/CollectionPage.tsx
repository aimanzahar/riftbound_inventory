import { LayoutGrid, RefreshCw, SearchX, Settings } from 'lucide-react';
import { useStore } from '../store/store.ts';
import { useVisibleIds } from '../store/selectors.ts';
import { go } from '../lib/router.ts';
import { FilterBar } from '../components/filters/FilterBar.tsx';
import { FilterSheet } from '../components/filters/FilterSheet.tsx';
import { SummaryStrip } from '../components/layout/SummaryStrip.tsx';
import { CardGrid } from '../components/cards/CardGrid.tsx';
import { CardList } from '../components/cards/CardList.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { SkeletonTile, SkeletonRows } from '../components/ui/Skeleton.tsx';
import { Button } from '../components/ui/Button.tsx';

export function CollectionPage() {
  const boot = useStore((s) => s.boot);
  const view = useStore((s) => s.ui.view);
  const total = useStore((s) => s.cardIds.length);
  const search = useStore((s) => s.ui.search);
  const own = useStore((s) => s.ui.filters.own);
  const resetFilters = useStore((s) => s.resetFilters);
  const runJob = useStore((s) => s.runJob);
  const cardsRunning = useStore((s) => s.jobs.find((j) => j.name === 'cards')?.running ?? false);
  const ids = useVisibleIds();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilterBar className="hidden sm:flex" />
      <FilterSheet />
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-1.5">
        <SummaryStrip visible={ids.length} total={total} />
      </div>
      <div className="relative min-h-0 flex-1">
        {boot !== 'ready' ? (
          view === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-busy="true" aria-label="Loading cards">
              {Array.from({ length: 18 }, (_, i) => (
                <SkeletonTile key={i} />
              ))}
            </div>
          ) : (
            <SkeletonRows rows={12} />
          )
        ) : total === 0 ? (
          <EmptyState
            icon={<LayoutGrid />}
            title="No cards yet"
            description="The catalog is empty. Run the “cards” job to pull every printing from Riot’s gallery — it takes about a minute."
            action={
              <>
                <Button variant="primary" leftIcon={<RefreshCw className="size-4" />} loading={cardsRunning} onClick={() => void runJob('cards')}>
                  Load the card catalog
                </Button>
                <Button variant="ghost" leftIcon={<Settings className="size-4" />} onClick={() => go('settings')}>
                  Open Settings
                </Button>
              </>
            }
          />
        ) : ids.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={search ? `Nothing matches “${search}”` : own === 'owned' ? 'Nothing owned here yet' : own === 'missing' ? 'Nothing missing — complete!' : own === 'extras' ? 'No extras beyond a playset' : 'No cards match these filters'}
            description={search ? 'Try a shorter name, or a number like “45” or “OGN-045”.' : 'Loosen a filter or clear them all.'}
            action={
              <Button variant="outline" onClick={resetFilters}>
                Clear filters
              </Button>
            }
          />
        ) : view === 'grid' ? (
          <CardGrid ids={ids} dimWhenZero={own === 'all'} />
        ) : (
          <CardList ids={ids} />
        )}
      </div>
    </div>
  );
}
