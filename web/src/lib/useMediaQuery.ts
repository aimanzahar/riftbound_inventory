import { useSyncExternalStore } from 'react';

const cache = new Map<string, MediaQueryList>();
function mql(q: string): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null;
  let m = cache.get(q);
  if (!m) {
    m = window.matchMedia(q);
    cache.set(q, m);
  }
  return m;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = mql(query);
      if (!m) return () => {};
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => mql(query)?.matches ?? false,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsPhone = () => useMediaQuery('(max-width: 639px)');
export const useIsCoarse = () => useMediaQuery('(pointer: coarse)');
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
