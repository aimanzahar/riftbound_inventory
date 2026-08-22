import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUp, RefreshCw, SearchX } from 'lucide-react';
import type { Change } from '../../../../shared/types.ts';
import { api, errorMessage } from '../../lib/api.ts';
import { cx, pluralize } from '../../lib/format.ts';
import { usePrefersReducedMotion } from '../../lib/useMediaQuery.ts';
import { useStore } from '../../store/store.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Skeleton } from '../ui/Skeleton.tsx';
import { ChangeItem } from './ChangeItem.tsx';

// ---------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------

export type KindFilter = 'all' | 'inventory' | 'purchases' | 'packs' | 'csv' | 'decks' | 'tips' | 'system';
export const KIND_FILTERS: readonly KindFilter[] = ['all', 'inventory', 'purchases', 'packs', 'csv', 'decks', 'tips', 'system'];
export const KIND_FILTER_LABELS: Record<KindFilter, string> = {
  all: 'All',
  inventory: 'Inventory',
  purchases: 'Purchases',
  packs: 'Packs',
  csv: 'CSV',
  decks: 'Decks',
  tips: 'Tips',
  system: 'System',
};

export interface FeedFilter {
  kind: KindFilter;
  /** device id; null = everyone */
  actor: string | null;
}

/** Part of the filter the server can apply (`kind=` / `reason=`); the rest is checked client-side. */
function serverQuery(k: KindFilter): { kind?: string; reason?: string } {
  switch (k) {
    case 'inventory':
      return { kind: 'inventory' };
    case 'purchases':
      return { kind: 'inventory', reason: 'product' };
    case 'packs':
      return { kind: 'inventory', reason: 'pack' };
    case 'csv':
      return { kind: 'inventory', reason: 'csv' };
    case 'decks':
      return { kind: 'deck' };
    case 'tips':
      return { kind: 'tip' };
    default:
      return {};
  }
}

export function changeMatches(c: Change, f: FeedFilter): boolean {
  switch (f.kind) {
    case 'inventory':
      if (c.kind !== 'inventory') return false;
      break;
    case 'purchases':
      if (c.kind !== 'inventory' || c.reason !== 'product') return false;
      break;
    case 'packs':
      if (c.kind !== 'inventory' || c.reason !== 'pack') return false;
      break;
    case 'csv':
      if (c.kind !== 'inventory' || c.reason !== 'csv') return false;
      break;
    case 'decks':
      if (c.kind !== 'deck') return false;
      break;
    case 'tips':
      if (c.kind !== 'tip') return false;
      break;
    case 'system':
      if (c.device !== null) return false;
      break;
  }
  if (f.actor && c.device?.id !== f.actor) return false;
  return true;
}

// ---------------------------------------------------------------------------
// feed state: older pages via `before=`, live head via `after=` on every seq bump
// ---------------------------------------------------------------------------

const PAGE = 50;
/** stop paging once a load produced at least this many visible rows */
const MIN_MATCH = 20;
/** max server pages per load (client-side filters may skip whole pages) */
const MAX_HOPS = 6;
const HEAD_LIMIT = 500;

interface FeedState {
  items: Change[];
  status: 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  done: boolean;
  error: string | null;
  /** rows prepended while the user was scrolled down */
  fresh: number;
  /** bumps after every completed page load (re-arms the scroll sentinel) */
  loads: number;
}

interface FeedRefs {
  gen: number;
  /** smallest seq fetched so far (next `before=`) */
  cursor: number | null;
  /** largest seq accounted for (next `after=`) */
  head: number;
  done: boolean;
  loadingMore: boolean;
  headBusy: boolean;
  headDirty: boolean;
  status: FeedState['status'];
}

const INITIAL: FeedState = { items: [], status: 'loading', loadingMore: false, done: false, error: null, fresh: 0, loads: 0 };

function useChangesFeed(filter: FeedFilter, atTop: () => boolean) {
  const storeSeq = useStore((s) => s.seq);
  const [state, setState] = useState<FeedState>(INITIAL);
  const [reloadKey, setReloadKey] = useState(0);
  const r = useRef<FeedRefs>({ gen: 0, cursor: null, head: 0, done: false, loadingMore: false, headBusy: false, headDirty: false, status: 'loading' });
  const filterRef = useRef(filter);
  filterRef.current = filter;
  r.current.status = state.status;
  const filterKey = `${filter.kind}|${filter.actor ?? ''}`;

  /** Fetch older pages until enough rows match (or the log ends). Commits cursor/done only if still current. */
  const loadOlder = useCallback(async (gen: number): Promise<{ matched: Change[]; done: boolean; maxSeen: number } | null> => {
    const f = filterRef.current;
    const q = serverQuery(f.kind);
    const matched: Change[] = [];
    let cursor = r.current.cursor;
    let done = r.current.done;
    let maxSeen = 0;
    let hops = 0;
    while (!done && hops < MAX_HOPS && matched.length < MIN_MATCH) {
      hops++;
      const res = await api.changes({ limit: PAGE, before: cursor ?? undefined, ...q });
      if (gen !== r.current.gen) return null;
      const page = res.changes; // newest first
      if (page.length) {
        cursor = page[page.length - 1].seq;
        maxSeen = Math.max(maxSeen, page[0].seq);
      }
      if (page.length < PAGE) done = true;
      for (const c of page) if (changeMatches(c, f)) matched.push(c);
    }
    r.current.cursor = cursor;
    r.current.done = done;
    return { matched, done, maxSeen };
  }, []);

  // (re)load from the top whenever the filter changes
  useEffect(() => {
    const cur = r.current;
    const gen = ++cur.gen;
    cur.cursor = null;
    cur.head = 0;
    cur.done = false;
    cur.loadingMore = false;
    cur.headBusy = false;
    cur.headDirty = false;
    setState(INITIAL);
    void (async () => {
      try {
        const res = await loadOlder(gen);
        if (!res || gen !== cur.gen) return;
        cur.head = Math.max(res.maxSeen, useStore.getState().seq);
        setState({ items: res.matched, status: 'ready', loadingMore: false, done: res.done, error: null, fresh: 0, loads: 1 });
      } catch (e) {
        if (gen !== cur.gen) return;
        setState({ ...INITIAL, status: 'error', error: errorMessage(e) });
      }
    })();
  }, [filterKey, reloadKey, loadOlder]);

  const loadMore = useCallback(async (): Promise<void> => {
    const cur = r.current;
    if (cur.done || cur.loadingMore || cur.status !== 'ready') return;
    const gen = cur.gen;
    cur.loadingMore = true;
    setState((s) => ({ ...s, loadingMore: true, error: null }));
    try {
      const res = await loadOlder(gen);
      if (!res || gen !== cur.gen) return;
      setState((s) => {
        const have = new Set(s.items.map((i) => i.seq));
        const add = res.matched.filter((c) => !have.has(c.seq));
        return { ...s, items: add.length ? [...s.items, ...add] : s.items, done: res.done, loadingMore: false, loads: s.loads + 1 };
      });
    } catch (e) {
      if (gen !== cur.gen) return;
      setState((s) => ({ ...s, loadingMore: false, error: errorMessage(e) }));
    } finally {
      if (gen === cur.gen) cur.loadingMore = false;
    }
  }, [loadOlder]);

  /** Pull everything newer than `head` (ascending) and prepend what matches; mark undone targets. */
  const fetchHead = useCallback(async (gen: number): Promise<void> => {
    const cur = r.current;
    if (cur.headBusy) {
      cur.headDirty = true;
      return;
    }
    cur.headBusy = true;
    try {
      const f = filterRef.current;
      const q = serverQuery(f.kind);
      // everything ≤ the store's seq is already in the DB by the time this request is served
      const target = useStore.getState().seq;
      const fresh: Change[] = [];
      const undone = new Set<number>();
      let after = cur.head;
      for (let loops = 0; loops < 5; loops++) {
        const res = await api.changes({ after: after > 0 ? after : undefined, limit: HEAD_LIMIT, ...q });
        if (gen !== cur.gen) return;
        const page = [...res.changes].sort((a, b) => a.seq - b.seq);
        for (const c of page) {
          if (c.undo_of !== null) undone.add(c.undo_of);
          if (changeMatches(c, f)) fresh.push(c);
        }
        if (page.length) after = Math.max(after, page[page.length - 1].seq);
        // without `after` the server returns the newest rows (descending) — one page is all we can use
        if (page.length < HEAD_LIMIT || cur.head === 0) break;
      }
      cur.head = Math.max(cur.head, after, target);
      if (fresh.length || undone.size) {
        const badge = !atTop();
        setState((s) => {
          const have = new Set(s.items.map((i) => i.seq));
          const add = fresh.filter((c) => !have.has(c.seq)).reverse(); // newest first
          let items = add.length ? [...add, ...s.items] : s.items;
          if (undone.size) items = items.map((i) => (undone.has(i.seq) && !i.undone ? { ...i, undone: true } : i));
          return { ...s, items, fresh: badge ? s.fresh + add.length : 0 };
        });
      }
    } catch (e) {
      // the next seq bump (or the SSE watchdog) retries
      console.warn('[activity] head refetch failed', errorMessage(e));
    } finally {
      cur.headBusy = false;
      if (cur.headDirty) {
        cur.headDirty = false;
        void fetchHead(gen);
      }
    }
  }, [atTop]);

  // live: the store bumps `seq` for every change it sees (SSE, own writes, resyncs)
  useEffect(() => {
    const cur = r.current;
    if (state.status !== 'ready') return;
    if (storeSeq <= cur.head) return;
    const gen = cur.gen;
    const t = window.setTimeout(() => void fetchHead(gen), 200);
    return () => window.clearTimeout(t);
  }, [storeSeq, state.status, fetchHead]);

  const markUndone = useCallback((seq: number) => {
    setState((s) => (s.items.some((i) => i.seq === seq && !i.undone) ? { ...s, items: s.items.map((i) => (i.seq === seq ? { ...i, undone: true } : i)) } : s));
  }, []);

  const markSeen = useCallback(() => {
    setState((s) => (s.fresh ? { ...s, fresh: 0 } : s));
  }, []);

  /** Page back until `seq` is inside the fetched range (it may still be filtered out). */
  const ensureLoaded = useCallback(
    async (seq: number): Promise<void> => {
      const cur = r.current;
      for (let hops = 0; hops < 10 && !cur.done && (cur.cursor === null || seq < cur.cursor); hops++) {
        await loadMore();
        if (cur.loadingMore) return; // another load is running; give up quietly
      }
    },
    [loadMore],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return { ...state, loadMore, retry, markUndone, markSeen, ensureLoaded };
}

// ---------------------------------------------------------------------------
// day grouping
// ---------------------------------------------------------------------------

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date, now: number): string {
  const today = new Date(now);
  if (dayKey(d) === dayKey(today)) return 'Today';
  const y = new Date(now - 86_400_000);
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
}

interface DayGroup {
  key: string;
  label: string;
  items: Change[];
}

function groupByDay(items: Change[], now: number): DayGroup[] {
  const out: DayGroup[] = [];
  for (const c of items) {
    const d = new Date(c.ts);
    const key = Number.isFinite(d.getTime()) ? dayKey(d) : 'unknown';
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(c);
    else out.push({ key, label: key === 'unknown' ? 'Unknown date' : dayLabel(d, now), items: [c] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

function FeedSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4 sm:px-6" aria-busy="true" aria-label="Loading activity">
      <Skeleton className="h-3.5 w-14" />
      <div className="divide-y divide-border rounded-xl border border-border bg-surface">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-7" rounded="rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface ActivityFeedProps {
  filter: FeedFilter;
  onClearFilters: () => void;
}

/** Newest-first feed of change rows, grouped by day, infinite scroll, live prepend, per-row Undo. */
export function ActivityFeed({ filter, onClearFilters }: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const atTop = useCallback(() => (scrollRef.current?.scrollTop ?? 0) < 8, []);
  const feed = useChangesFeed(filter, atTop);
  const { items, status, loadingMore, done, error, fresh, loads, loadMore, retry, markUndone, markSeen, ensureLoaded } = feed;
  const me = useStore((s) => s.me);
  const undo = useStore((s) => s.undo);
  const toast = useStore((s) => s.toast);
  const reducedMotion = usePrefersReducedMotion();
  const [busySeq, setBusySeq] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const highlightTimer = useRef<number | null>(null);

  // relative times refresh once a minute
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => () => {
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
  }, []);

  const filtered = filter.kind !== 'all' || filter.actor !== null;
  const groups = useMemo(() => groupByDay(items, now), [items, now]);

  // infinite scroll: observe the sentinel inside our own scroll container
  useEffect(() => {
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root || done || status !== 'ready') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { root, rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [done, status, loadMore, loads]);

  const onUndo = useCallback(
    async (seq: number) => {
      setBusySeq(seq);
      const ok = await undo(seq);
      if (ok) markUndone(seq);
      setBusySeq(null);
    },
    [undo, markUndone],
  );

  const flash = useCallback((seq: number) => {
    setHighlight(seq);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlight(null), 1800);
  }, []);

  const onJump = useCallback(
    async (seq: number) => {
      await ensureLoaded(seq);
      requestAnimationFrame(() => {
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`);
        if (!el) {
          toast({ kind: 'info', text: `Change #${seq} isn’t in this view — switch the filter to All to see it.` });
          return;
        }
        el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        flash(seq);
      });
    },
    [ensureLoaded, toast, reducedMotion, flash],
  );

  const scrollToTop = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    markSeen();
  };

  if (status === 'loading') return <FeedSkeleton />;

  if (status === 'error' && items.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState
          icon={<Activity />}
          title="Couldn’t load the activity log"
          description={error ?? 'The server did not answer.'}
          action={
            <Button variant="primary" leftIcon={<RefreshCw className="size-4" />} onClick={retry}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (items.length === 0 && done) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered ? (
          <EmptyState
            icon={<SearchX />}
            title="Nothing here"
            description="No changes match this filter yet."
            action={
              <Button variant="outline" onClick={onClearFilters}>
                Show everything
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<Activity />} title="No activity yet" description="Every change — yours, your brother’s and the nightly data jobs — lands here with an Undo button. Add a card or open a pack to get started." />
        )}
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 8) markSeen();
        }}
        className="h-full overflow-y-auto"
        aria-busy={loadingMore}
      >
        <section aria-label="Activity feed" className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-2">
              <h2 className="sticky top-0 z-10 -mx-1 bg-bg/90 px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-faint backdrop-blur">{g.label}</h2>
              <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {g.items.map((c) => (
                  <ChangeItem key={c.seq} change={c} now={now} mine={c.device?.id === me.id} busy={busySeq === c.seq} highlighted={highlight === c.seq} onUndo={onUndo} onJump={onJump} />
                ))}
              </ol>
            </div>
          ))}

          {/* footer: sentinel + manual fallback */}
          <div ref={sentinelRef} className="flex min-h-10 flex-col items-center justify-center gap-2 py-2 text-xs text-faint" aria-live="polite">
            {error && items.length > 0 && (
              <span className="flex items-center gap-2 text-danger">
                Couldn’t load more: {error}
                <Button variant="outline" size="xs" onClick={() => void loadMore()}>
                  Retry
                </Button>
              </span>
            )}
            {!error && loadingMore && (
              <span className="flex items-center gap-2">
                <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                Loading older changes…
              </span>
            )}
            {!error && !loadingMore && !done && (
              <Button variant="ghost" size="sm" onClick={() => void loadMore()} className="pointer-coarse:h-11">
                Load older changes
              </Button>
            )}
            {!error && !loadingMore && done && items.length > 0 && (
              <span>
                That’s everything · {pluralize(items.length, 'change')}
                {filtered ? ' in this view' : ''}
              </span>
            )}
            {!error && !loadingMore && done && items.length === 0 && <span>Nothing matches this filter.</span>}
          </div>
        </section>
      </div>

      {fresh > 0 && (
        <button
          type="button"
          onClick={scrollToTop}
          className={cx(
            'fade-up absolute top-3 left-1/2 z-20 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full border border-accent/50 bg-surface-2/95 px-3 text-xs font-semibold text-accent-strong shadow-pop backdrop-blur hover:bg-surface-3',
            'pointer-coarse:h-11 pointer-coarse:px-4',
          )}
        >
          <ArrowUp className="size-3.5" aria-hidden />
          {pluralize(fresh, 'new change')}
        </button>
      )}
    </div>
  );
}
