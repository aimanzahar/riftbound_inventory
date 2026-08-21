import { DOMAINS } from '../../../shared/constants.ts';
import { EMPTY_FILTERS, SORT_KEYS, type Filters, type OwnFilter, type SortKey } from './types.ts';

/** The collection's filter/search/sort state as it appears in the hash query. */
export interface QueryState {
  filters: Filters;
  search: string;
  sort: SortKey;
}

function list(q: URLSearchParams, key: string): string[] {
  const v = q.get(key);
  if (!v) return [];
  return [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
}

/** `#/?set=OGN,SFD&domain=fury&type=Unit&rarity=Rare&own=missing&foil=1&meta=1&q=jinx&sort=price` */
export function queryToState(q: URLSearchParams): QueryState {
  const own = q.get('own') as OwnFilter | null;
  const sort = q.get('sort') as SortKey | null;
  const domains = list(q, 'domain').map((d) => d.toLowerCase()).filter((d) => d in DOMAINS);
  return {
    filters: {
      sets: list(q, 'set').map((s) => s.toUpperCase()),
      domains,
      types: list(q, 'type'),
      rarities: list(q, 'rarity'),
      own: own && ['all', 'owned', 'missing', 'extras'].includes(own) ? own : 'all',
      foil: q.get('foil') === '1',
      meta: q.get('meta') === '1',
    },
    search: q.get('q') ?? '',
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'number',
  };
}

export function stateToQuery(s: QueryState, base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base ?? undefined);
  for (const k of ['set', 'domain', 'type', 'rarity', 'own', 'foil', 'meta', 'q', 'sort']) q.delete(k);
  const f = s.filters;
  if (f.sets.length) q.set('set', f.sets.join(','));
  if (f.domains.length) q.set('domain', f.domains.join(','));
  if (f.types.length) q.set('type', f.types.join(','));
  if (f.rarities.length) q.set('rarity', f.rarities.join(','));
  if (f.own !== 'all') q.set('own', f.own);
  if (f.foil) q.set('foil', '1');
  if (f.meta) q.set('meta', '1');
  if (s.search) q.set('q', s.search);
  if (s.sort !== 'number') q.set('sort', s.sort);
  return q;
}

export function sameFilters(a: Filters, b: Filters): boolean {
  return (
    a.own === b.own &&
    a.foil === b.foil &&
    a.meta === b.meta &&
    sameList(a.sets, b.sets) &&
    sameList(a.domains, b.domains) &&
    sameList(a.types, b.types) &&
    sameList(a.rarities, b.rarities)
  );
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function activeFilterCount(f: Filters): number {
  return f.sets.length + f.domains.length + f.types.length + f.rarities.length + (f.own !== 'all' ? 1 : 0) + (f.foil ? 1 : 0) + (f.meta ? 1 : 0);
}

export function isEmptyFilters(f: Filters): boolean {
  return sameFilters(f, EMPTY_FILTERS);
}

export function toggleInList(listv: string[], v: string): string[] {
  return listv.includes(v) ? listv.filter((x) => x !== v) : [...listv, v];
}
