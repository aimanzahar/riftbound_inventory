import type {
  Catalog,
  Change,
  Device,
  InventoryRequest,
  InventoryResponse,
  JobStatus,
  PriceHistoryPoint,
  PurchasePreview,
  Settings,
  State,
  Tip,
} from '../../../shared/types.ts';
import type { JobName } from '../../../shared/constants.ts';
import { getDeviceId } from './identity.ts';
import { uuid } from './uuid.ts';

export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
  /** true for fetch failures / timeouts (no HTTP response) and 5xx */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.status === 0 ? 'Can’t reach the server' : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function newOpId(): string {
  return uuid();
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOpts {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function request<T>(method: Method, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Device-Id': getDeviceId(), ...(opts.headers ?? {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20_000);
  const onOuterAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal, cache: 'no-store' });
  } catch (e) {
    throw new ApiError(0, 'NETWORK', (e as Error)?.message || 'Network error');
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onOuterAbort);
  }
  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError(res.status, 'BAD_JSON', 'Server returned an unexpected response');
    }
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; [k: string]: unknown } } | null)?.error;
    const { code, message, ...extra } = err ?? {};
    throw new ApiError(res.status, code ?? `HTTP_${res.status}`, message ?? res.statusText ?? 'Request failed', extra);
  }
  return json as T;
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function qs(params: object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  seq: number;
  started_at: string;
  lan_urls: string[];
  clients: number;
}

export interface BackupFile {
  file: string;
  size_bytes: number;
  created_at: string;
}

export interface JobsResponse {
  jobs: JobStatus[];
  backups: BackupFile[];
  images: { mirrored: number; total: number };
}

export interface ChangesQuery {
  limit?: number;
  before?: number;
  after?: number;
  kind?: string;
  reason?: string;
  card_id?: string;
  entity?: string;
}

export type CatalogResult = { notModified: true } | { notModified: false; catalog: Catalog; etag: string | null };

export const api = {
  health: (opts?: RequestOpts) => request<HealthResponse>('GET', '/api/health', undefined, { timeoutMs: 6000, ...opts }),

  /** Conditional GET: pass the last ETag to get `{notModified:true}` when unchanged. */
  async catalog(etag: string | null = null, opts?: RequestOpts): Promise<CatalogResult> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Device-Id': getDeviceId() };
    if (etag) headers['If-None-Match'] = etag;
    let res: Response;
    try {
      res = await fetch('/api/catalog', { headers, signal: opts?.signal, cache: 'no-store' });
    } catch (e) {
      throw new ApiError(0, 'NETWORK', (e as Error)?.message || 'Network error');
    }
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText || 'Catalog request failed');
    const catalog = (await res.json()) as Catalog;
    return { notModified: false, catalog, etag: res.headers.get('ETag') };
  },

  state: (opts?: RequestOpts) => request<State>('GET', '/api/state', undefined, opts),

  changes: (q: ChangesQuery = {}, opts?: RequestOpts) => request<{ changes: Change[] }>('GET', `/api/changes${qs(q)}`, undefined, opts),

  inventory: (req: InventoryRequest, opts?: RequestOpts) => request<InventoryResponse>('POST', '/api/inventory', req, opts),

  undo: (seq: number, op_id: string) => request<{ change: Change }>('POST', `/api/changes/${seq}/undo`, { op_id }),

  preview: (productId: string, qty = 1) => request<PurchasePreview>('GET', `/api/products/${enc(productId)}/preview?qty=${qty}`),

  buy: (productId: string, qty: number, op_id: string) => request<InventoryResponse>('POST', `/api/products/${enc(productId)}/buy`, { op_id, qty }),

  priceHistory: (cardId: string, days = 90, opts?: RequestOpts) =>
    request<{ history: PriceHistoryPoint[] }>('GET', `/api/prices/${enc(cardId)}/history?days=${days}`, undefined, opts),

  putTip: (cardId: string, text: string, op_id: string) => request<{ tip: Tip; change: Change }>('PUT', `/api/tips/${enc(cardId)}`, { op_id, text }),

  putDevice: (id: string, name: string, color: string) => request<{ device: Device }>('PUT', `/api/devices/${enc(id)}`, { name, color }),

  putSettings: (patch: Partial<Settings>, op_id: string) => request<{ settings: Settings }>('PUT', '/api/settings', { ...patch, op_id }),

  jobs: (opts?: RequestOpts) => request<JobsResponse>('GET', '/api/jobs', undefined, opts),

  jobRuns: (name: JobName) => request<{ runs: unknown[] }>('GET', `/api/jobs/${name}/runs`),

  runJob: (name: JobName, force = false) => request<{ queued: true; job: string }>('POST', `/api/jobs/${name}/run`, { force }),
};

export type Api = typeof api;
