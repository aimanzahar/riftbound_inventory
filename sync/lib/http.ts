import { USER_AGENT } from '../../shared/constants.ts';

export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function fetchWithRetry(url: string, o: FetchOpts = {}): Promise<Response> {
  const retries = o.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(new Error(`timeout after ${o.timeoutMs ?? 20000} ms`)), o.timeoutMs ?? 20000);
    const onAbort = () => ac.abort(o.signal?.reason);
    o.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/plain, */*', ...(o.headers ?? {}) },
        redirect: 'follow',
      });
      if (res.status >= 500 && attempt < retries) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
      } else return res;
    } catch (e) {
      lastErr = e;
      if (o.signal?.aborted) throw e;
    } finally {
      clearTimeout(t);
      o.signal?.removeEventListener('abort', onAbort);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchJson<T = unknown>(url: string, o: FetchOpts = {}): Promise<T> {
  const res = await fetchWithRetry(url, o);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${text.slice(0, 80).replace(/\s+/g, ' ')}…) for ${url}`);
  }
}

export async function fetchText(url: string, o: FetchOpts = {}): Promise<string> {
  const res = await fetchWithRetry(url, o);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

export async function fetchBuffer(url: string, o: FetchOpts = {}): Promise<{ buf: Buffer; contentType: string; status: number }> {
  const res = await fetchWithRetry(url, { ...o, headers: { Accept: 'image/*,*/*', ...(o.headers ?? {}) } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, contentType: res.headers.get('content-type') ?? '', status: res.status };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run tasks with bounded concurrency and optional spacing between starts. */
export async function pooled<T, R>(items: T[], concurrency: number, spacingMs: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let lastStart = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const wait = lastStart + spacingMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
