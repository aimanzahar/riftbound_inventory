import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, RefreshCw, Search, SearchX, Swords, X } from 'lucide-react';
import { useStore } from '../store/store.ts';
import { META_STALE_HOURS, canonicalOf, metaIsStale, useCard } from '../store/selectors.ts';
import { closeCard, navigate, useRoute } from '../lib/router.ts';
import { cx, fmtInt, relTime } from '../lib/format.ts';
import { Chip } from '../components/filters/FilterBar.tsx';
import { DomainPips } from '../components/cards/DomainPips.tsx';
import { Segmented } from '../components/ui/Segmented.tsx';
import { Button } from '../components/ui/Button.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { ArchetypeCard, LegendArt, fmtPlacement, fmtShare } from '../components/meta/ArchetypeCard.tsx';
import { DeckCard } from '../components/meta/DeckCard.tsx';
import { DeckDetail } from '../components/meta/DeckDetail.tsx';
import { DeckCompletion } from '../components/meta/DeckCompletion.tsx';
import {
  DAYS_OPTIONS,
  DEFAULT_META_QUERY,
  META_SORTS,
  META_SORT_LABELS,
  metaFilterCount,
  metaQueryToParams,
  parseMetaQuery,
  tierLabel,
  useMetaModel,
  type Archetype,
  type DaysWindow,
  type MetaModel,
  type MetaQuery,
  type MetaSort,
} from '../components/meta/metaModel.ts';

/**
 * `#/meta` — tournament decks grouped by legend.
 *   level 1: ArchetypeCard grid (filters: tier, date window, region, legend; sort; search)
 *   level 2: `?legend=<name>` → deck list + DeckDetail (`?deck=<id>` selects a list; the representative one by default)
 *   `?card=<id>` (the drawer card) narrows everything to decks using that card.
 */
export function MetaPage() {
  const route = useRoute();
  const boot = useStore((s) => s.boot);
  const deckCount = useStore((s) => s.decks.length);
  const runJob = useStore((s) => s.runJob);
  const metaJob = useStore((s) => s.jobs.find((j) => j.name === 'meta'));
  const focusCard = useCard(route.cardId);
  const cardCanon = focusCard ? canonicalOf(focusCard) : null;
  const query = useMemo(() => parseMetaQuery(route.query), [route.query]);
  const model = useMetaModel(query, cardCanon);

  const update = (patch: Partial<MetaQuery>, push = false) => {
    navigate({ page: 'meta', cardId: route.cardId, query: metaQueryToParams({ ...query, ...patch }) }, { replace: !push });
  };
  const clearFilters = () => update({ ...DEFAULT_META_QUERY, legend: query.legend, deck: query.deck });
  const selected = query.legend ? (model.archetypes.find((a) => a.key === query.legend) ?? null) : null;
  const filterCount = metaFilterCount(query);

  if (boot !== 'ready') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 p-4" aria-busy="true" aria-label="Loading meta decks">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-xl border border-border bg-surface p-3" aria-hidden>
            <Skeleton className="aspect-[5/7] w-16" rounded="rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="mt-auto h-1.5 w-full" rounded="rounded-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (deckCount === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          icon={<Swords />}
          title="No meta decks yet"
          description="Tournament lists from the last 120 days are pulled by the “meta” job. Run it now to see which archetypes are winning and how close your collection is to each of them."
          action={
            <Button variant="primary" leftIcon={<RefreshCw className="size-4" />} loading={metaJob?.running ?? false} onClick={() => void runJob('meta')}>
              Fetch meta decks
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar query={query} model={model} update={update} clearFilters={clearFilters} filterCount={filterCount} metaRefreshedAt={metaJob?.last_success_at ?? null} metaRunning={metaJob?.running ?? false} metaFailed={metaJob?.last?.status === 'error'} />

      {focusCard && (
        <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2" role="status">
          <Swords className="size-4 shrink-0 text-accent-strong" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-[13px]">
            <span className="text-muted">Decks using</span> <strong className="font-semibold text-fg">{focusCard.name}</strong>
            {model.cardUse && model.cardUse.decks > 0 ? (
              <span className="tabular text-muted">
                {' — '}
                {fmtInt(model.cardUse.archetypes)} archetype{model.cardUse.archetypes === 1 ? '' : 's'} · {fmtInt(model.cardUse.decks)} of {fmtInt(model.windowTotal)} decks · avg {model.cardUse.avgCopies.toFixed(1)}× per deck
              </span>
            ) : (
              <span className="text-muted"> — no tracked deck in this window plays it</span>
            )}
          </p>
          <Button variant="ghost" size="sm" onClick={closeCard} leftIcon={<X className="size-4" />} aria-label={`Show all decks (stop filtering by ${focusCard.name})`}>
            Show all
          </Button>
        </div>
      )}

      <div className="@container relative min-h-0 flex-1">
        {query.legend ? (
          selected ? (
            <ArchetypeView
              a={selected}
              query={query}
              focusName={focusCard?.name ?? null}
              focusCanon={cardCanon}
              onBack={() => update({ legend: null, deck: null }, true)}
              onSelectDeck={(id) => update({ deck: id }, true)}
              onBackToList={() => update({ deck: null }, true)}
            />
          ) : (
            <EmptyState
              icon={<SearchX />}
              title={`No decks for “${query.legend}” here`}
              description={focusCard ? `No ${query.legend} list in this window plays ${focusCard.name}.` : 'This legend has no tracked decks inside the current date range / filters.'}
              action={
                <>
                  {query.days !== 0 && (
                    <Button variant="outline" onClick={() => update({ days: 0 })}>
                      Show all dates
                    </Button>
                  )}
                  {filterCount > 0 && (
                    <Button variant="outline" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )}
                  <Button variant="ghost" leftIcon={<ArrowLeft className="size-4" />} onClick={() => update({ legend: null, deck: null }, true)}>
                    All archetypes
                  </Button>
                </>
              }
            />
          )
        ) : model.archetypes.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={focusCard ? `No tracked deck plays ${focusCard.name}` : query.q.trim() ? `Nothing matches “${query.q.trim()}”` : 'No decks match these filters'}
            description={focusCard ? 'Try a wider date range, or show all decks.' : 'Widen the date range or clear a filter.'}
            action={
              <>
                {query.days !== 0 && (
                  <Button variant="outline" onClick={() => update({ days: 0 })}>
                    Show all dates
                  </Button>
                )}
                {filterCount > 0 && (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                {focusCard && (
                  <Button variant="ghost" onClick={closeCard}>
                    Show all decks
                  </Button>
                )}
              </>
            }
          />
        ) : (
          <div className="h-full overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3" role="list" aria-label="Archetypes">
              {model.archetypes.map((a) => (
                <div key={a.key} role="listitem" className="flex">
                  <ArchetypeCard a={a} focusName={focusCard?.name ?? null} onOpen={() => update({ legend: a.key, deck: null }, true)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// toolbar
// ---------------------------------------------------------------------------

/** How fresh the deck corpus is, and whether that should be shown as a warning. */
function metaFreshness(lastSuccessAt: string | null, running: boolean, failed: boolean): { text: string; title: string; warn: boolean } {
  if (running) return { text: 'refreshing…', title: 'The meta sync job is running now', warn: false };
  const text = lastSuccessAt ? `refreshed ${relTime(lastSuccessAt)}` : 'never refreshed';
  if (failed) return { text, title: 'The last meta sync failed — this is when it last succeeded. Settings → Jobs has the error.', warn: true };
  if (!lastSuccessAt) return { text, title: 'The meta sync job has never finished successfully', warn: true };
  if (metaIsStale(lastSuccessAt)) return { text, title: `No successful meta sync in over ${META_STALE_HOURS} h — these decks may be out of date`, warn: true };
  return { text, title: 'Last successful meta sync', warn: false };
}

interface ToolbarProps {
  query: MetaQuery;
  model: MetaModel;
  update: (patch: Partial<MetaQuery>, push?: boolean) => void;
  clearFilters: () => void;
  filterCount: number;
  /** last SUCCESSFUL meta sync — not the last attempt, so a failing job can't masquerade as fresh */
  metaRefreshedAt: string | null;
  metaRunning: boolean;
  metaFailed: boolean;
}

function Toolbar({ query, model, update, clearFilters, filterCount, metaRefreshedAt, metaRunning, metaFailed }: ToolbarProps) {
  const toggle = (listv: string[], v: string) => (listv.includes(v) ? listv.filter((x) => x !== v) : [...listv, v]);
  const summary = [
    `${fmtInt(model.archetypes.length)} archetype${model.archetypes.length === 1 ? '' : 's'}`,
    `${fmtInt(model.shownTotal)}${model.narrowed ? ` of ${fmtInt(model.windowTotal)}` : ''} deck${(model.narrowed ? model.windowTotal : model.shownTotal) === 1 ? '' : 's'}`,
    `${fmtInt(model.events)} event${model.events === 1 ? '' : 's'}`,
  ];
  const freshness = metaFreshness(metaRefreshedAt, metaRunning, metaFailed);
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-bg/80 px-4 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <MetaSearch value={query.q} onChange={(q) => update({ q })} className="w-full sm:w-[240px]" />
        <Segmented<string>
          size="sm"
          ariaLabel="Date range"
          value={String(query.days)}
          onChange={(v) => update({ days: Number(v) as DaysWindow })}
          options={DAYS_OPTIONS.map((o) => ({ value: String(o.value), label: o.label, title: o.title }))}
        />
        <Segmented<MetaSort> size="sm" ariaLabel="Sort archetypes" value={query.sort} onChange={(s) => update({ sort: s })} options={META_SORTS.map((s) => ({ value: s, label: META_SORT_LABELS[s], title: `Sort by ${META_SORT_LABELS[s].toLowerCase()}` }))} />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-faint">
          <span className="sr-only">Legend</span>
          <select
            value={query.legend ?? ''}
            onChange={(e) => update({ legend: e.target.value || null, deck: null }, true)}
            aria-label="Legend"
            className="h-8 max-w-[220px] rounded-lg border border-border bg-surface-2 px-2 text-[13px] text-fg focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            <option value="">All legends ({model.legends.length})</option>
            {model.legends.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name} ({l.count})
              </option>
            ))}
          </select>
        </label>
        {filterCount > 0 && (
          <button type="button" onClick={clearFilters} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg">
            <X className="size-3.5" aria-hidden />
            Clear {filterCount}
          </button>
        )}
        <span className="tabular ml-auto hidden text-[11.5px] text-muted sm:inline" aria-live="polite">
          {summary.join(' · ')} ·{' '}
          <span className={cx(freshness.warn && 'font-medium text-warning')} title={freshness.title}>
            {freshness.text}
          </span>
        </span>
      </div>
      <div className="no-scrollbar flex items-center gap-x-5 overflow-x-auto py-0.5">
        {model.tiers.length > 0 && (
          <Group label="Tier">
            {model.tiers.map((t) => (
              <Chip key={t.key} active={query.tiers.includes(t.key)} onClick={() => update({ tiers: toggle(query.tiers, t.key) })} count={t.count} title={`${tierLabel(t.key)} events`}>
                {tierLabel(t.key)}
              </Chip>
            ))}
          </Group>
        )}
        {model.regions.length > 0 && (
          <Group label="Region">
            {model.regions.map((r) => (
              <Chip key={r.key} active={query.regions.includes(r.key)} onClick={() => update({ regions: toggle(query.regions, r.key) })} count={r.count}>
                {r.key}
              </Chip>
            ))}
          </Group>
        )}
        <span className="tabular ml-auto shrink-0 text-[11px] text-muted sm:hidden">
          {summary.slice(0, 2).join(' · ')}
          {freshness.warn && (
            <>
              {' · '}
              <span className="font-medium text-warning" title={freshness.title}>
                {freshness.text}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label={label}>
      <span className="mr-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      {children}
    </div>
  );
}

/** Local, debounced (60 ms) search over legends / champions / players / events; Esc clears. */
function MetaSearch({ value, onChange, className }: { value: string; onChange: (q: string) => void; className?: string }) {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
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
    <div className={cx('relative flex min-w-0 items-center', className)}>
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
        placeholder="Legend, champion, player, event…"
        aria-label="Search meta decks"
        autoComplete="off"
        spellCheck={false}
        className={cx(
          'h-8 w-full min-w-0 rounded-lg border border-border bg-surface-2 pl-8 text-[13px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/30 [&::-webkit-search-cancel-button]:appearance-none',
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

// ---------------------------------------------------------------------------
// level 2: one archetype → deck list + detail
// ---------------------------------------------------------------------------

interface ArchetypeViewProps {
  a: Archetype;
  query: MetaQuery;
  focusName: string | null;
  focusCanon: string | null;
  onBack: () => void;
  onSelectDeck: (id: string) => void;
  onBackToList: () => void;
}

function ArchetypeView({ a, query, focusName, focusCanon, onBack, onSelectDeck, onBackToList }: ArchetypeViewProps) {
  const explicit = query.deck ? (a.shown.find((d) => d.id === query.deck) ?? null) : null;
  const deck = explicit ?? a.representative;
  const detailOnNarrow = explicit !== null;
  const shown = a.shown.length;
  const all = a.decks.length;
  const listRef = useRef<HTMLUListElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);

  // keep the selected deck in view when it changes via keyboard / URL, and start its detail at the top
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    el?.scrollIntoView({ block: 'nearest' });
    paneRef.current?.scrollTo({ top: 0 });
  }, [deck.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="sm" onClick={onBack} leftIcon={<ArrowLeft className="size-4" />} aria-label="Back to all archetypes">
          <span className="hidden sm:inline">Archetypes</span>
        </Button>
        <LegendArt card={a.legendCard} name={a.legendName} className="w-9" rounded="rounded-md" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-tight" title={a.legendName}>
            {a.legendName}
          </h2>
          <p className="tabular flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
            {a.legendCard && a.legendCard.domains.length > 0 && <DomainPips domains={a.legendCard.domains} size="xs" />}
            <span>
              <strong className="font-semibold text-fg">{fmtInt(shown)}</strong>
              {shown !== all ? ` of ${fmtInt(all)}` : ''} deck{(shown !== all ? all : shown) === 1 ? '' : 's'}
            </span>
            <span aria-hidden>·</span>
            <span>{fmtShare(a.share)} share</span>
            <span aria-hidden>·</span>
            <span>best {fmtPlacement(a.best)}</span>
            <span aria-hidden>·</span>
            <span>avg {a.avg === null ? '—' : a.avg.toFixed(1)}</span>
            <span aria-hidden>·</span>
            <span>{a.top8} top-8</span>
            <span className="hidden sm:inline" aria-hidden>
              ·
            </span>
            <span className="hidden sm:inline">
              {fmtInt(a.events)} event{a.events === 1 ? '' : 's'}
            </span>
            {a.cardUse && focusName && (
              <>
                <span aria-hidden>·</span>
                <span className="text-accent-strong">
                  plays {focusName} {a.cardUse.avgCopies.toFixed(1)}× avg
                </span>
              </>
            )}
          </p>
        </div>
        <div className="hidden w-44 shrink-0 md:block">
          <DeckCompletion owned={a.completion.owned} total={a.completion.total} prefix="Rep. list" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ul
          ref={listRef}
          aria-label={`${a.legendName} decks`}
          className={cx(
            'min-h-0 w-full flex-col gap-2 overflow-y-auto border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] @3xl:flex @3xl:w-[340px] @3xl:shrink-0 @3xl:border-r',
            detailOnNarrow ? 'hidden' : 'flex',
          )}
        >
          {a.shown.map((d) => (
            <DeckCard key={d.id} deck={d} selected={d.id === deck.id} representative={d.id === a.representative.id} onSelect={() => onSelectDeck(d.id)} />
          ))}
        </ul>
        <div ref={paneRef} className={cx('min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain @3xl:flex', detailOnNarrow ? 'flex' : 'hidden')}>
          <DeckDetail key={deck.id} deck={deck} onBack={onBackToList} backClassName="@3xl:hidden" focusCanon={focusCanon} />
        </div>
      </div>
    </div>
  );
}
