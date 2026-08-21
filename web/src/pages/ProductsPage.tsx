import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Boxes, PackageSearch, RefreshCw, Search, X } from 'lucide-react';
import type { Card, Product, ProductKind, PurchaseRecord, SetRow } from '../../../shared/types.ts';
import { useStore } from '../store/store.ts';
import { computeProductStatus, useOwnedByCanonical, type ProductStatus } from '../store/selectors.ts';
import { getRoute, setQuery, useRoute } from '../lib/router.ts';
import { cx, fmtDate, fmtInt } from '../lib/format.ts';
import { Chip } from '../components/filters/FilterBar.tsx';
import { KIND_ORDER, ProductCard, fallbackCardFor, isFixedList, kindPlural, kindLabel } from '../components/products/ProductCard.tsx';
import { PurchaseDialog } from '../components/products/PurchaseDialog.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

type SortDir = 'newest' | 'oldest';
const OTHER = 'other';

interface StatusEntry {
  status: ProductStatus;
  boughtQty: number;
}

interface KindGroup {
  kind: ProductKind;
  items: Product[];
}
interface SetGroup {
  key: string;
  code: string | null;
  label: string;
  release: string | null;
  kinds: KindGroup[];
  count: number;
}

function listParam(q: URLSearchParams, key: string): string[] {
  const v = q.get(key);
  return v ? [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))] : [];
}

function searchable(p: Product): string {
  return `${p.name} ${p.id} ${p.set_code ?? ''} ${kindLabel(p.kind)}`.toLowerCase();
}

/**
 * Products grouped by set → kind. Filters/search/sort live in the hash query
 * (`#/products?q=jinx&set=OGN&kind=champion_deck&sort=oldest&bought=1&product=<id>`).
 */
export function ProductsPage() {
  const boot = useStore((s) => s.boot);
  const products = useStore((s) => s.products);
  const sets = useStore((s) => s.sets);
  const purchases = useStore((s) => s.purchases);
  const cardsById = useStore((s) => s.cardsById);
  const fxRate = useStore((s) => s.fx?.rate ?? null);
  const runJob = useStore((s) => s.runJob);
  const productsRunning = useStore((s) => s.jobs.find((j) => j.name === 'products')?.running ?? false);
  const ownedByCanonical = useOwnedByCanonical();
  const route = useRoute();

  // ---- query state ----
  const q = route.query;
  const search = q.get('q') ?? '';
  const setFilter = listParam(q, 'set').map((s) => (s.toLowerCase() === OTHER ? OTHER : s.toUpperCase()));
  const kindFilter = listParam(q, 'kind');
  const sortDir: SortDir = q.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const boughtOnly = q.get('bought') === '1';
  const openId = q.get('product');

  // reads the LIVE route (not the render-time one) so a debounced search commit never clobbers a chip toggled meanwhile
  const update = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(getRoute().query);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setQuery(next);
  }, []);
  const toggleIn = (key: string, list: string[], v: string) => update({ [key]: (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(',') || null });
  const activeCount = setFilter.length + kindFilter.length + (boughtOnly ? 1 : 0) + (search ? 1 : 0);
  const clearAll = () => update({ q: null, set: null, kind: null, bought: null });

  // ---- derived ----
  const statusById = useMemo(() => {
    const m = new Map<string, StatusEntry>();
    const byProduct = new Map<string, PurchaseRecord[]>();
    for (const p of purchases) {
      if (p.undone) continue;
      const arr = byProduct.get(p.product_id);
      if (arr) arr.push(p);
      else byProduct.set(p.product_id, [p]);
    }
    for (const p of products) {
      const status = computeProductStatus(p, purchases, ownedByCanonical, cardsById);
      const boughtQty = (byProduct.get(p.id) ?? []).reduce((a, x) => a + (x.qty || 1), 0);
      m.set(p.id, { status, boughtQty });
    }
    return m;
  }, [products, purchases, ownedByCanonical, cardsById]);

  const fallbackById = useMemo(() => {
    const m = new Map<string, Card | undefined>();
    for (const p of products) m.set(p.id, fallbackCardFor(p, cardsById));
    return m;
  }, [products, cardsById]);

  const setName = useMemo(() => new Map(sets.map((s) => [s.code, s])), [sets]);
  const setOrder = useMemo(() => new Map(sets.map((s, i) => [s.code, i])), [sets]);

  const needle = search.trim().toLowerCase();
  const passes = useCallback(
    (p: Product, opts: { ignoreSet?: boolean; ignoreKind?: boolean; ignoreBought?: boolean } = {}) => {
      if (needle && !searchable(p).includes(needle)) return false;
      if (!opts.ignoreSet && setFilter.length && !setFilter.includes(p.set_code ?? OTHER)) return false;
      if (!opts.ignoreKind && kindFilter.length && !kindFilter.includes(p.kind)) return false;
      if (!opts.ignoreBought && boughtOnly && (statusById.get(p.id)?.status.timesBought ?? 0) === 0) return false;
      return true;
    },
    [needle, setFilter, kindFilter, boughtOnly, statusById],
  );

  const matches = useMemo(() => products.filter((p) => passes(p)), [products, passes]);

  const counts = useMemo(() => {
    const bySet = new Map<string, number>();
    const byKind = new Map<string, number>();
    let bought = 0;
    for (const p of products) {
      if (passes(p, { ignoreSet: true })) bySet.set(p.set_code ?? OTHER, (bySet.get(p.set_code ?? OTHER) ?? 0) + 1);
      if (passes(p, { ignoreKind: true })) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
      if (passes(p, { ignoreBought: true }) && (statusById.get(p.id)?.status.timesBought ?? 0) > 0) bought++;
    }
    return { bySet, byKind, bought };
  }, [products, passes, statusById]);

  const setOptions = useMemo(() => {
    const codes = new Set<string>();
    let other = false;
    for (const p of products) {
      if (p.set_code) codes.add(p.set_code);
      else other = true;
    }
    const arr = [...codes].sort((a, b) => (setOrder.get(a) ?? 999) - (setOrder.get(b) ?? 999) || a.localeCompare(b));
    return other ? [...arr, OTHER] : arr;
  }, [products, setOrder]);

  const kindOptions = useMemo(() => {
    const present = new Set(products.map((p) => p.kind));
    return KIND_ORDER.filter((k) => present.has(k));
  }, [products]);

  const groups = useMemo<SetGroup[]>(() => {
    const dir = sortDir === 'newest' ? -1 : 1;
    const byDate = (a: Product, b: Product) => dir * ((a.release_date ?? '').localeCompare(b.release_date ?? '')) || a.name.localeCompare(b.name);
    const bySet = new Map<string, Product[]>();
    for (const p of matches) {
      const k = p.set_code ?? OTHER;
      const arr = bySet.get(k);
      if (arr) arr.push(p);
      else bySet.set(k, [p]);
    }
    const out: SetGroup[] = [];
    for (const [key, items] of bySet) {
      const set: SetRow | undefined = key === OTHER ? undefined : setName.get(key);
      const kinds: KindGroup[] = [];
      for (const kind of KIND_ORDER) {
        const ks = items.filter((p) => p.kind === kind).sort(byDate);
        if (ks.length) kinds.push({ kind, items: ks });
      }
      const minRelease = items.reduce<string | null>((a, p) => (p.release_date && (!a || p.release_date < a) ? p.release_date : a), null);
      out.push({
        key,
        code: key === OTHER ? null : key,
        label: key === OTHER ? 'Other & upcoming' : (set?.name ?? key),
        release: set?.release_date ?? minRelease,
        kinds,
        count: items.length,
      });
    }
    out.sort((a, b) => {
      if (a.code === null) return 1;
      if (b.code === null) return -1;
      const ia = setOrder.get(a.code) ?? 999,
        ib = setOrder.get(b.code) ?? 999;
      return dir * (ia - ib) || dir * (a.release ?? '').localeCompare(b.release ?? '');
    });
    return out;
  }, [matches, sortDir, setName, setOrder]);

  const openProduct = useMemo(() => (openId ? (products.find((p) => p.id === openId) ?? null) : null), [products, openId]);
  const onOpen = useCallback((p: Product) => update({ product: p.id }), [update]);
  const onCloseDialog = useCallback(() => update({ product: null }), [update]);

  const fixedCount = useMemo(() => products.filter(isFixedList).length, [products]);
  const boughtCount = useMemo(() => products.filter((p) => (statusById.get(p.id)?.status.timesBought ?? 0) > 0).length, [products, statusById]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="flex flex-col gap-2 border-b border-border bg-bg/80 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2">
          <ProductSearch value={search} onChange={(v) => update({ q: v || null })} />
          <Segmented<SortDir>
            size="sm"
            ariaLabel="Sort by release date"
            value={sortDir}
            onChange={(v) => update({ sort: v === 'newest' ? null : v })}
            options={[
              { value: 'newest', label: 'Newest', title: 'Newest releases first' },
              { value: 'oldest', label: 'Oldest', title: 'Oldest releases first' },
            ]}
          />
          {activeCount > 0 && (
            <button type="button" onClick={clearAll} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg">
              <X className="size-3.5" aria-hidden />
              Clear {activeCount}
            </button>
          )}
        </div>
        <div className="no-scrollbar flex items-center gap-5 overflow-x-auto py-0.5">
          {setOptions.length > 0 && (
            <Group label="Set">
              {setOptions.map((code) => (
                <Chip key={code} active={setFilter.includes(code)} onClick={() => toggleIn('set', setFilter, code)} count={counts.bySet.get(code) ?? 0} title={code === OTHER ? 'Promos, bundles and unreleased sets' : setName.get(code)?.name}>
                  {code === OTHER ? 'Other' : code}
                </Chip>
              ))}
            </Group>
          )}
          {kindOptions.length > 0 && (
            <Group label="Kind">
              {kindOptions.map((k) => (
                <Chip key={k} active={kindFilter.includes(k)} onClick={() => toggleIn('kind', kindFilter, k)} count={counts.byKind.get(k) ?? 0}>
                  {kindPlural(k)}
                </Chip>
              ))}
            </Group>
          )}
          <Group label="More">
            <Chip active={boughtOnly} onClick={() => update({ bought: boughtOnly ? null : '1' })} count={counts.bought} title="Only products you recorded as bought">
              Bought
            </Chip>
          </Group>
        </div>
      </div>

      {/* summary strip */}
      <div className="tabular flex flex-wrap items-center gap-x-1.5 border-b border-border px-4 py-1.5 text-[12.5px] text-muted" aria-label="Products summary">
        <span>
          <strong className="font-semibold text-fg">{fmtInt(products.length)}</strong> products
        </span>
        <Dot />
        <span>
          <strong className="font-semibold text-fg">{fmtInt(fixedCount)}</strong> with card lists
        </span>
        <Dot />
        <span>
          <strong className={cx('font-semibold', boughtCount ? 'text-success' : 'text-fg')}>{fmtInt(boughtCount)}</strong> bought
        </span>
        {matches.length !== products.length && (
          <>
            <span className="mx-1 text-faint">·</span>
            <span className="text-accent">
              showing {fmtInt(matches.length)} of {fmtInt(products.length)}
            </span>
          </>
        )}
      </div>

      {/* content */}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {boot !== 'ready' ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]" aria-busy="true" aria-label="Loading products">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3" aria-hidden>
                <Skeleton className="aspect-[4/3] w-full" rounded="rounded-lg" />
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-5 w-24" rounded="rounded-md" />
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title="No products yet"
            description="Precon decks, kits and boosters come from seed/products.json. Run the “products” job once the card catalog is loaded."
            action={
              <Button variant="primary" leftIcon={<RefreshCw className="size-4" />} loading={productsRunning} onClick={() => void runJob('products')}>
                Load products
              </Button>
            }
          />
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<PackageSearch />}
            title={search ? `Nothing matches “${search}”` : boughtOnly ? 'Nothing bought yet' : 'No products match these filters'}
            description={search ? 'Try a champion name (“Jinx”), a set code (“VEN”) or a kind (“kit”).' : boughtOnly ? 'Open a product and press “Add” to record a purchase — it shows up here.' : 'Loosen a filter or clear them all.'}
            action={
              <Button variant="outline" onClick={clearAll}>
                Clear filters
              </Button>
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-labelledby={`set-${g.key}`} className="pb-2">
              <header className="sticky top-0 z-[1] flex items-baseline gap-2 border-b border-border bg-bg/90 px-4 py-2 backdrop-blur">
                <h2 id={`set-${g.key}`} className="text-[15px] font-semibold tracking-tight">
                  {g.label}
                </h2>
                <span className="tabular text-xs text-muted">
                  {g.code ? `${g.code} · ` : ''}
                  {g.count} product{g.count === 1 ? '' : 's'}
                  {g.release ? ` · ${fmtDate(g.release)}` : ''}
                </span>
              </header>
              {g.kinds.map((k) => (
                <div key={k.kind} className="px-4 pt-3 pb-1">
                  <h3 className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wider text-faint uppercase">
                    {kindPlural(k.kind)}
                    <span className="tabular font-medium">{k.items.length}</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
                    {k.items.map((p) => {
                      const st = statusById.get(p.id);
                      if (!st) return null;
                      return <ProductCard key={p.id} product={p} status={st.status} boughtQty={st.boughtQty} fallbackCard={fallbackById.get(p.id)} fxRate={fxRate} onOpen={onOpen} />;
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      <PurchaseDialog product={openProduct} open={Boolean(openProduct)} onClose={onCloseDialog} />
    </div>
  );
}

/** Debounced (60 ms) name search bound to the `q` query param. */
function ProductSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (value !== local && document.activeElement !== ref.current) setLocal(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const commit = (v: string, immediate = false) => {
    setLocal(v);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate) {
      timer.current = null;
      onChange(v);
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onChange(v);
    }, 60);
  };
  return (
    <div className="relative flex min-w-0 flex-1 items-center sm:max-w-[360px]">
      <Search className="pointer-events-none absolute left-2.5 size-4 text-faint" aria-hidden />
      <input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={local}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (local) {
              e.preventDefault();
              e.stopPropagation();
              commit('', true);
            } else ref.current?.blur();
          }
          if (e.key === 'Enter') commit(local, true);
        }}
        placeholder="Search products…"
        aria-label="Search products"
        autoComplete="off"
        spellCheck={false}
        className={cx(
          'h-8 w-full min-w-0 rounded-lg border border-border bg-surface-2 pl-8 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30 [&::-webkit-search-cancel-button]:appearance-none',
          local ? 'pr-8' : 'pr-3',
        )}
      />
      {local && (
        <button type="button" aria-label="Clear search" onClick={() => commit('', true)} className="absolute right-1.5 rounded-md p-1 text-faint hover:bg-surface-3 hover:text-fg">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-0.5 text-[10.5px] font-semibold tracking-wider text-faint uppercase">{label}</span>
      {children}
    </div>
  );
}

function Dot() {
  return (
    <span className="text-faint" aria-hidden>
      ·
    </span>
  );
}
