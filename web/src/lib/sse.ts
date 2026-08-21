import type { Change, HelloEvent, JobEvent, PresenceEvent } from '../../../shared/types.ts';
import { api } from './api.ts';
import { useStore } from '../store/store.ts';
import * as optimistic from '../store/optimistic.ts';

/**
 * EventSource lifecycle.
 *  - `hello` on every (re)connect: seq mismatch → refetch state; catalog_version mismatch → refetch catalog;
 *    then re-send pending ops.
 *  - `change` → store.ingestChange (gap detection + resync inside the store)
 *  - `presence` / `job` → store
 *  - watchdog: on visibilitychange/online and every 45 s while visible, recreate a CLOSED stream and
 *    compare `/api/health` seq with ours (SSE pings are comments, invisible to JS, so silence alone
 *    can't be trusted).
 */

let es: EventSource | null = null;
let started = false;
let reopenTimer: number | null = null;
let watchdogTimer: number | null = null;
let backoffMs = 1000;
let everConnected = false;

function me() {
  return useStore.getState().me;
}

function url(): string {
  const m = me();
  const q = new URLSearchParams({ device_id: m.id });
  if (m.name) q.set('name', m.name);
  if (m.color) q.set('color', m.color);
  return `/api/events?${q.toString()}`;
}

function setConn(c: 'connecting' | 'live' | 'reconnecting' | 'offline') {
  useStore.getState().setConnection(c);
}

function parse<T>(e: MessageEvent): T | null {
  try {
    return JSON.parse(String(e.data)) as T;
  } catch {
    return null;
  }
}

function open(): void {
  close();
  if (typeof EventSource === 'undefined') {
    setConn('offline');
    return;
  }
  setConn(everConnected ? 'reconnecting' : 'connecting');
  const source = new EventSource(url());
  es = source;

  source.onopen = () => {
    if (es !== source) return;
    backoffMs = 1000;
    everConnected = true;
    setConn('live');
  };
  source.onerror = () => {
    if (es !== source) return;
    setConn(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'reconnecting');
    if (source.readyState === EventSource.CLOSED) scheduleReopen();
    // CONNECTING: the browser retries on its own (retry: 2000)
  };
  source.addEventListener('hello', (e) => {
    if (es !== source) return;
    const h = parse<HelloEvent>(e as MessageEvent);
    if (!h) return;
    const store = useStore.getState();
    const restarted = store.setServerInstance(h.instance);
    if (store.boot === 'ready') {
      if (h.catalog_version !== store.catalog_version || restarted) void store.refetchCatalog();
      if (h.seq !== store.seq || restarted) void store.refetchState();
    }
    optimistic.flush();
  });
  source.addEventListener('change', (e) => {
    if (es !== source) return;
    const c = parse<Change>(e as MessageEvent);
    if (c) useStore.getState().ingestChange(c);
  });
  source.addEventListener('presence', (e) => {
    if (es !== source) return;
    const p = parse<PresenceEvent>(e as MessageEvent);
    if (p) useStore.getState().setPresence(p.devices);
  });
  source.addEventListener('job', (e) => {
    if (es !== source) return;
    const j = parse<JobEvent>(e as MessageEvent);
    if (j) useStore.getState().setJobEvent(j);
  });
}

function close(): void {
  if (reopenTimer !== null) {
    window.clearTimeout(reopenTimer);
    reopenTimer = null;
  }
  if (es) {
    es.onopen = null;
    es.onerror = null;
    es.close();
    es = null;
  }
}

function scheduleReopen(): void {
  if (!started || reopenTimer !== null) return;
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, 15_000);
  reopenTimer = window.setTimeout(() => {
    reopenTimer = null;
    if (started) open();
  }, wait);
}

async function check(): Promise<void> {
  if (!started) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setConn('offline');
    return;
  }
  if (!es || es.readyState === EventSource.CLOSED) {
    open();
    return;
  }
  try {
    const h = await api.health();
    const store = useStore.getState();
    if (store.boot === 'ready' && h.seq !== store.seq) void store.refetchState();
    if (es && es.readyState === EventSource.OPEN) setConn('live');
  } catch {
    setConn('reconnecting');
    // the stream is probably dead too; force a fresh one
    open();
  }
}

/** Start (idempotent). Call once the device has a name. */
export function connectRealtime(): void {
  if (started) return;
  started = true;
  open();
  const onVis = () => {
    if (!document.hidden) void check();
  };
  const onOnline = () => void check();
  const onOffline = () => setConn('offline');
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pageshow', onOnline);
  watchdogTimer = window.setInterval(() => void check(), 45_000);
  stopFns.push(() => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('pageshow', onOnline);
  });
}

const stopFns: Array<() => void> = [];

export function disconnectRealtime(): void {
  started = false;
  close();
  if (watchdogTimer !== null) {
    window.clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  for (const f of stopFns.splice(0)) f();
}

/** Reconnect with the current identity (after renaming) — presence picks up the new name. */
export function reconnectRealtime(): void {
  if (!started) return;
  open();
}

export function isRealtimeStarted(): boolean {
  return started;
}
