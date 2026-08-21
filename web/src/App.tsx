import { useEffect, useRef } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useStore } from './store/store.ts';
import { queryToState, stateToQuery, sameFilters } from './store/filters.ts';
import { connectRealtime } from './lib/sse.ts';
import { installHotkeys } from './lib/hotkeys.ts';
import { closeCard, getRoute, go, setQuery, useRoute } from './lib/router.ts';
import { Shell } from './components/layout/Shell.tsx';
import { IdentityDialog } from './components/layout/IdentityDialog.tsx';
import { Toaster } from './components/ui/Toaster.tsx';
import { ShortcutsHelp } from './components/ui/ShortcutsHelp.tsx';
import { HoverPreview } from './components/cards/HoverPreview.tsx';
import { usePreview } from './components/cards/previewStore.ts';
import { focusSearch } from './components/filters/SearchBox.tsx';
import { useFilterSheet } from './components/filters/FilterSheet.tsx';
import { Button } from './components/ui/Button.tsx';
import { CollectionPage } from './pages/CollectionPage.tsx';
import { ProductsPage } from './pages/ProductsPage.tsx';
import { MetaPage } from './pages/MetaPage.tsx';
import { PackPage } from './pages/PackPage.tsx';
import { ActivityPage } from './pages/ActivityPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

export function App() {
  const boot = useStore((s) => s.boot);
  const bootError = useStore((s) => s.bootError);
  const bootstrap = useStore((s) => s.bootstrap);
  const registered = useStore((s) => s.me.name.trim().length > 0);
  const helpOpen = useStore((s) => s.ui.helpOpen);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const liveMessage = useStore((s) => s.liveMessage);
  const route = useRoute();

  // boot: catalog + state in parallel
  useEffect(() => {
    if (boot === 'idle') void bootstrap();
  }, [boot, bootstrap]);

  // realtime once we know who this is
  useEffect(() => {
    if (registered) connectRealtime();
  }, [registered]);

  useRouteSync();

  // global hotkeys
  useEffect(
    () =>
      installHotkeys({
        focusSearch: () => {
          if (getRoute().page !== 'collection') go('collection');
          requestAnimationFrame(() => focusSearch());
        },
        escape: () => {
          const s = useStore.getState();
          const pv = usePreview.getState();
          if (pv.cardId) pv.hide();
          if (s.ui.helpOpen) s.setHelpOpen(false);
          else if (useFilterSheet.getState().open) useFilterSheet.getState().setOpen(false);
          else if (getRoute().cardId) closeCard();
          else if (s.ui.search) s.setSearch('');
        },
        goto: (page) => go(page),
        pack: () => go('pack'),
        help: () => useStore.getState().setHelpOpen(!useStore.getState().ui.helpOpen),
        toggleView: () => {
          const s = useStore.getState();
          if (getRoute().page === 'collection') s.setView(s.ui.view === 'grid' ? 'list' : 'grid');
        },
        toggleFoil: () => {
          if (getRoute().page === 'collection') useStore.getState().toggleFoilSticky();
        },
      }),
    [],
  );

  // document title
  useEffect(() => {
    const name = useStore.getState().settings.collection_name || 'Riftbound Inventory';
    const card = route.cardId ? useStore.getState().cardsById.get(route.cardId)?.name : null;
    document.title = card ? `${card} · ${name}` : name;
  }, [route]);

  if (boot === 'error') {
    return (
      <div className="flex h-dvh items-center justify-center bg-bg p-6 text-fg">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-danger/40 bg-danger/10 text-danger">
            <TriangleAlert className="size-6" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Can’t reach the server</h1>
          <p className="text-sm text-muted">{bootError ?? 'The Riftbound server did not answer.'} Make sure it’s running on the PC (npm run dev / start.cmd) and you’re on the same Wi-Fi.</p>
          <Button variant="primary" leftIcon={<RefreshCw className="size-4" />} onClick={() => void bootstrap()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  let page;
  switch (route.page) {
    case 'products':
      page = <ProductsPage />;
      break;
    case 'meta':
      page = <MetaPage />;
      break;
    case 'pack':
      page = <PackPage />;
      break;
    case 'activity':
      page = <ActivityPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    default:
      page = <CollectionPage />;
  }

  return (
    <>
      <Shell>{page}</Shell>
      <Toaster />
      <HoverPreview />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <IdentityDialog open={!registered} />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
    </>
  );
}

/**
 * Two-way sync between the hash route and store.ui:
 *  route → store: filters/search/sort from the query (collection pages), drawerCardId from the path
 *  store → route: replaceState the query whenever filters/search/sort change on the collection
 */
function useRouteSync(): void {
  const route = useRoute();
  const applying = useRef(false);

  // route → store
  useEffect(() => {
    const s = useStore.getState();
    s.setDrawerCard(route.cardId);
    if (route.page !== 'collection') return;
    const q = queryToState(route.query);
    applying.current = true;
    if (!sameFilters(q.filters, s.ui.filters)) s.setFilters(q.filters);
    if (q.search !== s.ui.search) s.setSearch(q.search);
    if (q.sort !== s.ui.sort) s.setSort(q.sort);
    applying.current = false;
  }, [route]);

  // store → route
  useEffect(() => {
    let last = '';
    return useStore.subscribe((s, prev) => {
      if (applying.current) return;
      if (s.ui.filters === prev.ui.filters && s.ui.search === prev.ui.search && s.ui.sort === prev.ui.sort) return;
      const r = getRoute();
      if (r.page !== 'collection') return;
      const q = stateToQuery({ filters: s.ui.filters, search: s.ui.search, sort: s.ui.sort }, r.query);
      const str = q.toString();
      if (str === r.query.toString() || str === last) return;
      last = str;
      setQuery(q);
    });
  }, []);
}
