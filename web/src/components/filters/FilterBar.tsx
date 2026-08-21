import { useMemo, type ReactNode } from 'react';
import { Sparkles, Swords, X } from 'lucide-react';
import { useStore } from '../../store/store.ts';
import { useFacetCounts, useFacetOptions } from '../../store/selectors.ts';
import { activeFilterCount, toggleInList } from '../../store/filters.ts';
import type { OwnFilter } from '../../store/types.ts';
import { cx, fmtInt } from '../../lib/format.ts';
import { DomainChip } from '../cards/DomainPips.tsx';
import { RARITY_COLORS } from '../cards/CardTile.tsx';
import { Segmented } from '../ui/Segmented.tsx';

/** Chip with count; AND across groups, OR within a group. */
export function Chip({ active, onClick, children, count, dot, title }: { active: boolean; onClick: () => void; children: ReactNode; count?: number; dot?: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={cx(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors',
        active ? 'border-accent/60 bg-accent/15 text-accent-strong' : 'border-border bg-surface-2 text-muted hover:border-border-strong hover:text-fg',
        count === 0 && !active && 'opacity-50',
      )}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden />}
      {children}
      {count !== undefined && <span className={cx('tabular text-[11px]', active ? 'text-accent-strong/70' : 'text-faint')}>{fmtInt(count)}</span>}
    </button>
  );
}

function Group({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex shrink-0 items-center gap-1.5', className)} role="group" aria-label={label}>
      <span className="mr-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      {children}
    </div>
  );
}

/** All filter groups. `vertical` stacks them (mobile sheet); otherwise one scrollable row. */
export function FilterGroups({ vertical }: { vertical?: boolean }) {
  const filters = useStore((s) => s.ui.filters);
  const setFilters = useStore((s) => s.setFilters);
  const sets = useStore((s) => s.sets);
  const hasDecks = useStore((s) => s.decks.length > 0);
  const playset = useStore((s) => s.settings.playset_size);
  const opts = useFacetOptions();
  const counts = useFacetCounts();
  const setName = useMemo(() => new Map(sets.map((s) => [s.code, s.name])), [sets]);

  const ownOptions = [
    { value: 'all' as OwnFilter, label: 'All', count: counts.own.all },
    { value: 'owned' as OwnFilter, label: 'Owned', count: counts.own.owned },
    { value: 'missing' as OwnFilter, label: 'Missing', count: counts.own.missing },
    { value: 'extras' as OwnFilter, label: 'Extras', count: counts.own.extras, title: `More than a playset of ${playset}` },
  ];

  const wrap = vertical ? 'flex-wrap' : '';
  return (
    <div className={cx('flex gap-x-5 gap-y-3', vertical ? 'flex-col' : 'items-center')}>
      <Group label="Own" className={vertical ? 'flex-wrap' : ''}>
        <Segmented size="sm" ariaLabel="Ownership" options={ownOptions} value={filters.own} onChange={(v) => setFilters({ own: v })} />
      </Group>

      {opts.sets.length > 0 && (
        <Group label="Set" className={wrap}>
          {opts.sets.map((code) => (
            <Chip key={code} active={filters.sets.includes(code)} onClick={() => setFilters({ sets: toggleInList(filters.sets, code) })} count={counts.sets.get(code) ?? 0} title={setName.get(code)}>
              {code}
            </Chip>
          ))}
        </Group>
      )}

      {opts.domains.length > 0 && (
        <Group label="Domain" className={wrap}>
          {opts.domains.map((d) => (
            <DomainChip key={d} id={d} active={filters.domains.includes(d)} onClick={() => setFilters({ domains: toggleInList(filters.domains, d) })} count={counts.domains.get(d) ?? 0} />
          ))}
        </Group>
      )}

      {opts.types.length > 0 && (
        <Group label="Type" className={wrap}>
          {opts.types.map((t) => (
            <Chip key={t} active={filters.types.includes(t)} onClick={() => setFilters({ types: toggleInList(filters.types, t) })} count={counts.types.get(t) ?? 0}>
              {t}
            </Chip>
          ))}
        </Group>
      )}

      {opts.rarities.length > 0 && (
        <Group label="Rarity" className={wrap}>
          {opts.rarities.map((r) => (
            <Chip key={r} active={filters.rarities.includes(r)} onClick={() => setFilters({ rarities: toggleInList(filters.rarities, r) })} count={counts.rarities.get(r) ?? 0} dot={RARITY_COLORS[r] ?? '#6b7280'}>
              {r}
            </Chip>
          ))}
        </Group>
      )}

      <Group label="More" className={wrap}>
        <Chip active={filters.foil} onClick={() => setFilters({ foil: !filters.foil })} count={counts.foil} title="Only cards you own in foil">
          <Sparkles className="size-3.5" aria-hidden />
          Foil only
        </Chip>
        {hasDecks && (
          <Chip active={filters.meta} onClick={() => setFilters({ meta: !filters.meta })} count={counts.meta} title="Only cards used by current meta decks">
            <Swords className="size-3.5" aria-hidden />
            In meta
          </Chip>
        )}
      </Group>
    </div>
  );
}

/** Horizontal chip bar (≥640 px). */
export function FilterBar({ className }: { className?: string }) {
  const filters = useStore((s) => s.ui.filters);
  const resetFilters = useStore((s) => s.resetFilters);
  const search = useStore((s) => s.ui.search);
  const n = activeFilterCount(filters) + (search ? 1 : 0);
  return (
    <div className={cx('flex items-center gap-3 border-b border-border bg-bg/80 px-4 py-2 backdrop-blur', className)}>
      <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto py-0.5">
        <FilterGroups />
      </div>
      {n > 0 && (
        <button type="button" onClick={resetFilters} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted hover:bg-surface-2 hover:text-fg">
          <X className="size-3.5" aria-hidden />
          Clear {n}
        </button>
      )}
    </div>
  );
}
