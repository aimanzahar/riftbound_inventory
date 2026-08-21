import { useCallback, useEffect, useRef, useState } from 'react';

export type ImageKind = 'thumb' | 'full';

export interface ImageCard {
  id: string;
  image_url: string | null;
}

/** Resolved src per `${kind}:${id}`; '' means every candidate failed (placeholder). */
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function withSanityParams(url: string, kind: ImageKind): string {
  if (!/cmsassets\.rgpub\.io|cdn\.sanity\.io/.test(url)) return url;
  const p = kind === 'thumb' ? 'fm=webp&w=300&q=75' : 'fm=webp&w=744&q=80';
  return url + (url.includes('?') ? '&' : '?') + p;
}

/** Ordered candidate URLs. Thumb: local thumb → local full → remote → (placeholder).
 *  Full: local full → remote full → local thumb → remote thumb → (placeholder). */
export function imageCandidates(card: ImageCard, kind: ImageKind): string[] {
  const localFull = `/img/${card.id}.webp`;
  const localThumb = `/img/thumb/${card.id}.webp`;
  const remoteFull = card.image_url ? withSanityParams(card.image_url, 'full') : null;
  const remoteThumb = card.image_url ? withSanityParams(card.image_url, 'thumb') : null;
  const list = kind === 'thumb' ? [localThumb, localFull, remoteThumb] : [localFull, remoteFull, localThumb, remoteThumb];
  const out: string[] = [];
  for (const u of list) if (u && !out.includes(u)) out.push(u);
  return out;
}

export function cachedImage(id: string, kind: ImageKind): string | undefined {
  return resolved.get(`${kind}:${id}`);
}

export function rememberImage(id: string, kind: ImageKind, src: string): void {
  resolved.set(`${kind}:${id}`, src);
}

/** Probe the candidate chain with an off-screen Image; resolves the first src that loads ('' if none). */
export function preload(card: ImageCard, kind: ImageKind = 'full'): Promise<string> {
  const key = `${kind}:${card.id}`;
  const hit = resolved.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const candidates = imageCandidates(card, kind);
  const p = new Promise<string>((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        resolved.set(key, '');
        resolve('');
        return;
      }
      const src = candidates[i++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        resolved.set(key, src);
        resolve(src);
      };
      img.onerror = () => tryNext();
      img.src = src;
    };
    tryNext();
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export type ImageStatus = 'loading' | 'loaded' | 'failed';

export interface UseCardImage {
  src: string | null;
  status: ImageStatus;
  onLoad: () => void;
  onError: () => void;
}

/** Drives an <img>: walks the fallback chain on error, remembers the winner for re-mounts. */
export function useCardImage(card: ImageCard | null | undefined, kind: ImageKind): UseCardImage {
  const id = card?.id ?? '';
  const imageUrl = card?.image_url ?? null;
  const candidatesRef = useRef<string[]>([]);
  const [state, setState] = useState<{ id: string; kind: ImageKind; idx: number; status: ImageStatus; src: string | null }>(() =>
    initial(id, imageUrl, kind),
  );

  // reset when the card or kind changes
  if (state.id !== id || state.kind !== kind) {
    const next = initial(id, imageUrl, kind);
    candidatesRef.current = imageCandidates({ id, image_url: imageUrl }, kind);
    setState(next);
  }
  useEffect(() => {
    candidatesRef.current = imageCandidates({ id, image_url: imageUrl }, kind);
  }, [id, imageUrl, kind]);

  const onLoad = useCallback(() => {
    setState((s) => {
      if (s.src) rememberImage(s.id, s.kind, s.src);
      return s.status === 'loaded' ? s : { ...s, status: 'loaded' };
    });
  }, []);

  const onError = useCallback(() => {
    setState((s) => {
      const list = candidatesRef.current.length ? candidatesRef.current : imageCandidates({ id: s.id, image_url: imageUrl }, s.kind);
      // if we were showing a cached winner that now fails, restart the chain after it
      const cur = s.src ? list.indexOf(s.src) : -1;
      const nextIdx = (cur >= 0 ? cur : s.idx) + 1;
      if (nextIdx >= list.length) {
        rememberImage(s.id, s.kind, '');
        return { ...s, idx: nextIdx, status: 'failed', src: null };
      }
      return { ...s, idx: nextIdx, status: 'loading', src: list[nextIdx] };
    });
  }, [imageUrl]);

  return { src: state.src, status: state.status, onLoad, onError };
}

function initial(id: string, imageUrl: string | null, kind: ImageKind) {
  if (!id) return { id, kind, idx: 0, status: 'failed' as const, src: null };
  const hit = resolved.get(`${kind}:${id}`);
  if (hit !== undefined) return hit ? { id, kind, idx: 0, status: 'loading' as const, src: hit } : { id, kind, idx: 0, status: 'failed' as const, src: null };
  const list = imageCandidates({ id, image_url: imageUrl }, kind);
  return list.length ? { id, kind, idx: 0, status: 'loading' as const, src: list[0] } : { id, kind, idx: 0, status: 'failed' as const, src: null };
}
