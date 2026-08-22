import { useSyncExternalStore } from 'react';

export type Page = 'collection' | 'products' | 'meta' | 'decks' | 'pack' | 'activity' | 'settings';

export const PAGES: readonly Page[] = ['collection', 'products', 'meta', 'decks', 'pack', 'activity', 'settings'];

export interface Route {
  page: Page;
  /** open card drawer (`#/card/<id>` on the collection, `?card=<id>` elsewhere) */
  cardId: string | null;
  query: URLSearchParams;
  hash: string;
}

const PAGE_BY_SEGMENT: Record<string, Page> = {
  '': 'collection',
  card: 'collection',
  collection: 'collection',
  products: 'products',
  meta: 'meta',
  archetypes: 'meta', // '#/decks' used to alias the meta page; it now belongs to your own decks
  decks: 'decks',
  pack: 'pack',
  activity: 'activity',
  settings: 'settings',
};

export function parseHash(hash: string): Route {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!h.startsWith('/')) h = '/' + h;
  const qi = h.indexOf('?');
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const query = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
  const segs = path.split('/').filter(Boolean);
  const first = segs[0] ?? '';
  const page = PAGE_BY_SEGMENT[first] ?? 'collection';
  let cardId: string | null = null;
  if (first === 'card' && segs[1]) cardId = safeDecode(segs[1]).toUpperCase();
  const qc = query.get('card');
  if (!cardId && qc) cardId = qc.toUpperCase();
  query.delete('card');
  return { page, cardId, query, hash };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface RouteTarget {
  page: Page;
  cardId?: string | null;
  query?: URLSearchParams | Record<string, string> | null;
}

export function buildHash(r: RouteTarget): string {
  const q = r.query instanceof URLSearchParams ? new URLSearchParams(r.query) : new URLSearchParams(r.query ?? {});
  q.delete('card');
  let path: string;
  if (r.page === 'collection') path = r.cardId ? `/card/${encodeURIComponent(r.cardId)}` : '/';
  else {
    path = `/${r.page}`;
    if (r.cardId) q.set('card', r.cardId);
  }
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

// ---- tiny external store over location.hash ----
let current: Route = parseHash(typeof location !== 'undefined' ? location.hash : '');
const subs = new Set<() => void>();
function emit(): void {
  for (const s of subs) s();
}
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (location.hash === current.hash) return;
    current = parseHash(location.hash);
    emit();
  });
}

export function getRoute(): Route {
  return current;
}
export function subscribeRoute(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function navigate(target: RouteTarget, opts: { replace?: boolean } = {}): void {
  const hash = buildHash(target);
  if (hash === current.hash || hash === location.hash) {
    if (hash !== current.hash) {
      current = parseHash(hash);
      emit();
    }
    return;
  }
  current = parseHash(hash);
  if (opts.replace) history.replaceState(null, '', hash);
  else {
    // pushes a history entry; the hashchange listener sees an identical hash and no-ops
    history.pushState(null, '', hash);
  }
  emit();
}

/** Switch page; the collection keeps its filter query, other pages start clean. */
export function go(page: Page): void {
  if (page === current.page && !current.cardId) return;
  navigate({ page, cardId: null, query: page === 'collection' ? collectionQuery : null });
}

/** Remember the collection's last query so `go('collection')` restores filters. */
let collectionQuery: URLSearchParams = current.page === 'collection' ? current.query : new URLSearchParams();
subscribeRoute(() => {
  if (current.page === 'collection') collectionQuery = current.query;
});

export function openCard(id: string, opts: { replace?: boolean } = {}): void {
  navigate({ page: current.page, cardId: id, query: current.query }, opts);
}
export function closeCard(): void {
  if (!current.cardId) return;
  navigate({ page: current.page, cardId: null, query: current.query });
}
/** Replace the current query (used for filter/search/sort sync; no history entry). */
export function setQuery(q: URLSearchParams): void {
  navigate({ page: current.page, cardId: current.cardId, query: q }, { replace: true });
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribeRoute, getRoute, getRoute);
}

export function pageTitle(p: Page): string {
  switch (p) {
    case 'collection':
      return 'Collection';
    case 'products':
      return 'Products';
    case 'meta':
      return 'Meta';
    case 'decks':
      return 'My decks';
    case 'pack':
      return 'Pack mode';
    case 'activity':
      return 'Activity';
    case 'settings':
      return 'Settings';
  }
}
