import { useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store/store.ts';
import { setQuery, useRoute } from '../lib/router.ts';
import { cx, fmtInt } from '../lib/format.ts';
import { Avatar } from '../components/ui/Avatar.tsx';
import { ActivityFeed, KIND_FILTERS, KIND_FILTER_LABELS, type FeedFilter, type KindFilter } from '../components/activity/ActivityFeed.tsx';

/** Same look as the collection's filter chips, with a 44 px target on touch. */
function FilterChip({ active, onClick, children, title, ariaLabel }: { active: boolean; onClick: () => void; children: ReactNode; title?: string; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      title={title}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors pointer-coarse:h-11 pointer-coarse:px-3.5',
        active ? 'border-accent/60 bg-accent/15 text-accent-strong' : 'border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function isKind(v: string | null): v is KindFilter {
  return v !== null && (KIND_FILTERS as readonly string[]).includes(v);
}

/**
 * Activity — who did what, newest first, with Undo.
 * Filters live in the hash query (`#/activity?kind=inventory&actor=<deviceId>`) so they survive the drawer and reloads.
 */
export function ActivityPage() {
  const route = useRoute();
  const devices = useStore((s) => s.devices);
  const me = useStore((s) => s.me);
  const seq = useStore((s) => s.seq);

  const kindParam = route.query.get('kind');
  const kind: KindFilter = isKind(kindParam) ? kindParam : 'all';
  const actor = route.query.get('actor') || null;
  const filter = useMemo<FeedFilter>(() => ({ kind, actor }), [kind, actor]);

  const update = (patch: Partial<FeedFilter>) => {
    const next: FeedFilter = { kind, actor, ...patch };
    // "System" rows have no actor — the two filters can't both be set
    if (patch.kind === 'system') next.actor = null;
    if (patch.actor && next.kind === 'system') next.kind = 'all';
    const q = new URLSearchParams(route.query);
    q.delete('kind');
    q.delete('actor');
    if (next.kind !== 'all') q.set('kind', next.kind);
    if (next.actor) q.set('actor', next.actor);
    setQuery(q);
  };
  const clear = () => update({ kind: 'all', actor: null });

  const actors = useMemo(() => {
    const seen = new Set<string>();
    const list = devices.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
    return list.sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : b.last_seen_at.localeCompare(a.last_seen_at)));
  }, [devices, me.id]);
  const unknownActor = actor !== null && !actors.some((d) => d.id === actor);
  const filtered = kind !== 'all' || actor !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <div role="group" aria-label="Kind of change" className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
              {KIND_FILTERS.map((k) => (
                <FilterChip key={k} active={kind === k} onClick={() => update({ kind: k })} title={k === 'system' ? 'Price, FX, catalog and tip jobs' : undefined}>
                  {KIND_FILTER_LABELS[k]}
                </FilterChip>
              ))}
            </div>
            <span className="tabular hidden shrink-0 text-[11.5px] text-faint sm:inline" title="Changes recorded since the start">
              {fmtInt(seq)} total
            </span>
          </div>
          {(actors.length > 0 || unknownActor) && (
            <div role="group" aria-label="Who" className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5">
              <span className="mr-0.5 shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-faint">Who</span>
              {actors.map((d) => (
                <FilterChip
                  key={d.id}
                  active={actor === d.id}
                  onClick={() => update({ actor: actor === d.id ? null : d.id })}
                  ariaLabel={`${d.name}${d.id === me.id ? ' (you)' : ''}`}
                  title={d.id === me.id ? 'This device' : `Last seen ${new Date(d.last_seen_at).toLocaleString()}`}
                >
                  <Avatar name={d.name} color={d.color} size="xs" />
                  <span className="max-w-[9rem] truncate">{d.name}</span>
                  {d.id === me.id && <span className="text-faint">you</span>}
                </FilterChip>
              ))}
              {unknownActor && (
                <FilterChip active onClick={() => update({ actor: null })} title="Device not seen by this server">
                  Unknown device
                </FilterChip>
              )}
              {filtered && (
                <button
                  type="button"
                  onClick={clear}
                  className="ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:h-11 pointer-coarse:px-3"
                >
                  <X className="size-3.5" aria-hidden />
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <ActivityFeed filter={filter} onClearFilters={clear} />
    </div>
  );
}
