import { create } from 'zustand';
import type {
  Card,
  Catalog,
  Change,
  Deck,
  Device,
  DeviceRef,
  Finish,
  Fx,
  InvLine,
  InventoryItem,
  InventoryMode,
  InventoryPayload,
  InventoryResponse,
  InventoryRow,
  JobEvent,
  JobStatus,
  Price,
  Product,
  PurchaseRecord,
  ServerInfo,
  SetRow,
  Settings,
  SettingsPayload,
  State,
  Tip,
  TipPayload,
} from '../../../shared/types.ts';
import { MAX_ITEMS_PER_REQUEST, type JobName } from '../../../shared/constants.ts';
import { changeSummary } from '../../../shared/summarize.ts';
import { api, errorMessage, isApiError, newOpId, type BackupFile } from '../lib/api.ts';
import { loadIdentity, saveIdentity, type Identity } from '../lib/identity.ts';
import { signed } from '../lib/format.ts';
import { EMPTY_FILTERS, invKey, type BootStatus, type Connection, type Filters, type JobLive, type Pulse, type SortKey, type Toast, type UiState, type ViewMode } from './types.ts';
import * as optimistic from './optimistic.ts';

export type PresenceEntry = DeviceRef & { tabs: number };

export interface AppStore {
  // ---- boot / connection ----
  boot: BootStatus;
  bootError: string | null;
  connection: Connection;
  seq: number;
  catalog_version: number;

  // ---- catalog ----
  sets: SetRow[];
  cardsById: Map<string, Card>;
  cardIds: string[];
  products: Product[];
  decks: Deck[];

  // ---- live state ----
  inventory: Map<string, InventoryRow>;
  /** optimistic deltas per `id:finish` (sum of in-flight ops) */
  pending: Map<string, number>;
  prices: Map<string, Price>;
  pricesFetchedAt: string | null;
  fx: Fx | null;
  tips: Map<string, Tip>;
  devices: Device[];
  presence: PresenceEntry[];
  purchases: PurchaseRecord[];
  settings: Settings;
  jobs: JobStatus[];
  jobLive: JobLive;
  backups: BackupFile[];
  server: ServerInfo | null;
  /** remote-change pulses per card id */
  pulses: Map<string, Pulse>;
  recentChanges: Change[];
  me: Identity;
  ui: UiState;
  toasts: Toast[];
  /** polite aria-live text */
  liveMessage: string;

  // ---- boot / sync ----
  bootstrap(): Promise<void>;
  refetchState(): Promise<void>;
  refetchCatalog(): Promise<void>;
  refreshJobs(): Promise<void>;
  ingestChange(change: Change): void;
  applyLines(lines: InvLine[], ts: string, by: string | null): void;
  setConnection(c: Connection): void;
  setPresence(p: PresenceEntry[]): void;
  setJobEvent(ev: JobEvent): void;
  setServerInstance(instance: string): boolean;

  // ---- optimistic plumbing ----
  addPending(deltas: Map<string, number>): void;
  removePending(deltas: Map<string, number>): void;
  setLocalNote(cardId: string, finish: Finish, note: string): void;
  setTip(tip: Tip): void;

  // ---- user actions ----
  /** Optimistic ±delta. `opts.reason` defaults to 'manual' (pack mode passes 'pack'). Resolves with the server response once the op lands (null on failure / no-op). */
  adjust(cardId: string, finish: Finish, delta: number, opts?: optimistic.AdjustOptions): Promise<InventoryResponse | null>;
  setQty(cardId: string, finish: Finish, qty: number): void;
  setNote(cardId: string, finish: Finish, note: string): void;
  saveTip(cardId: string, text: string): Promise<boolean>;
  undo(seq: number): Promise<boolean>;
  registerDevice(name: string, color: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<boolean>;
  runJob(name: JobName, force?: boolean): Promise<boolean>;
  /** "I bought X": POST /api/products/:id/buy (not optimistic — awaits, applies the change, toasts with Undo). */
  buyProduct(productId: string, qty: number): Promise<boolean>;
  /** CSV import: POST /api/inventory (reason csv) in ≤5000-item chunks; toasts with Undo. */
  importCsv(args: { mode: InventoryMode; items: InventoryItem[]; csv_filename?: string }): Promise<boolean>;

  // ---- ui ----
  setFilters(patch: Partial<Filters>): void;
  resetFilters(): void;
  setSearch(q: string): void;
  setSort(s: SortKey): void;
  setView(v: ViewMode): void;
  toggleFoilSticky(): void;
  setPackSet(code: string | null): void;
  setHelpOpen(open: boolean): void;
  setDrawerCard(id: string | null): void;

  // ---- toasts / a11y ----
  toast(t: Omit<Toast, 'id' | 'at' | 'ttl'> & { ttl?: number }): number;
  updateToast(id: number, patch: Partial<Toast>): void;
  dismissToast(id: number): void;
  announce(msg: string): void;
}

const TOAST_TTL = 4000;
const MAX_TOASTS = 3;
let toastSeq = 0;
let catalogEtag: string | null = null;
let serverInstance: string | null = null;
let stateRefetchTimer: number | null = null;
let catalogRefetchTimer: number | null = null;
let jobsRefreshTimer: number | null = null;
let resyncInFlight: Promise<void> | null = null;
const gapBuffer: Change[] = [];

function readLocal<T extends string>(key: string, allowed: readonly T[], dflt: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : dflt;
  } catch {
    return dflt;
  }
}
function writeLocal(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

function indexCatalog(c: Catalog): Pick<AppStore, 'catalog_version' | 'sets' | 'cardsById' | 'cardIds' | 'products' | 'decks'> {
  const cardsById = new Map<string, Card>();
  const cardIds: string[] = [];
  for (const card of c.cards) {
    cardsById.set(card.id, card);
    cardIds.push(card.id);
  }
  return { catalog_version: c.catalog_version, sets: c.sets, cardsById, cardIds, products: c.products, decks: c.decks };
}

function indexState(s: State): Pick<AppStore, 'seq' | 'catalog_version' | 'inventory' | 'prices' | 'pricesFetchedAt' | 'fx' | 'tips' | 'devices' | 'purchases' | 'settings' | 'jobs' | 'server'> {
  const inventory = new Map<string, InventoryRow>();
  for (const r of s.inventory) inventory.set(invKey(r.card_id, r.finish), r);
  const prices = new Map<string, Price>();
  let fetchedAt: string | null = null;
  for (const p of s.prices) {
    prices.set(invKey(p.card_id, p.finish), p);
    if (!fetchedAt || p.fetched_at > fetchedAt) fetchedAt = p.fetched_at;
  }
  const tips = new Map<string, Tip>();
  for (const t of s.tips) tips.set(t.card_id, t);
  return {
    seq: s.seq,
    catalog_version: s.catalog_version,
    inventory,
    prices,
    pricesFetchedAt: fetchedAt,
    fx: s.fx,
    tips,
    devices: s.devices,
    purchases: s.purchases,
    settings: s.settings,
    jobs: s.jobs,
    server: s.server,
  };
}

const DEFAULT_SETTINGS: Settings = { playset_size: 3, rune_playset_size: 12, fx_manual_rate: null, collection_name: 'Riftbound Inventory' };

export const useStore = create<AppStore>()((set, get) => {
  // ---------- helpers (closure) ----------
  const lookupCard = (id: string) => get().cardsById.get(id);

  function scheduleStateRefetch(delay = 600): void {
    if (stateRefetchTimer !== null) window.clearTimeout(stateRefetchTimer);
    stateRefetchTimer = window.setTimeout(() => {
      stateRefetchTimer = null;
      void get().refetchState();
    }, delay);
  }
  function scheduleCatalogRefetch(delay = 300): void {
    if (catalogRefetchTimer !== null) window.clearTimeout(catalogRefetchTimer);
    catalogRefetchTimer = window.setTimeout(() => {
      catalogRefetchTimer = null;
      void get().refetchCatalog();
    }, delay);
  }
  function scheduleJobsRefresh(delay = 800): void {
    if (jobsRefreshTimer !== null) window.clearTimeout(jobsRefreshTimer);
    jobsRefreshTimer = window.setTimeout(() => {
      jobsRefreshTimer = null;
      void get().refreshJobs();
    }, delay);
  }

  function pulseCards(ids: string[], color: string): void {
    const now = Date.now();
    const next = new Map(get().pulses);
    for (const [k, v] of next) if (now - v.at > 10_000) next.delete(k);
    for (const id of ids) {
      const prev = next.get(id);
      next.set(id, { color, at: now, n: (prev?.n ?? 0) + 1 });
    }
    set({ pulses: next });
  }

  function pushRemoteToast(change: Change): void {
    const s = get();
    const dev = change.device;
    if (dev && dev.id === s.me.id) return; // never toast my own changes
    if (change.kind === 'inventory' && dev) {
      const p = change.payload as InventoryPayload;
      const ids = [...new Set(p.lines.map((l) => l.card_id))];
      const key = `inv:${dev.id}`;
      const now = Date.now();
      const existing = s.toasts.find((t) => t.key === key && t.agg && now - t.at < 3000);
      if (existing && existing.agg) {
        const agg = { ...existing.agg, delta: existing.agg.delta + p.summary.copies_delta, ids: [...new Set([...existing.agg.ids, ...ids])], count: existing.agg.count + 1 };
        const names = agg.ids.slice(0, 3).map((id) => lookupCard(id)?.name ?? id);
        const more = agg.ids.length > 3 ? `, +${agg.ids.length - 3} more` : '';
        const text = change.reason === 'pack' ? `${dev.name} is opening packs: ${signed(agg.delta)} (${names.join(', ')}${more})` : `${dev.name} ${signed(agg.delta)} cards (${names.join(', ')}${more})`;
        get().updateToast(existing.id, { agg, text, at: now, cardId: agg.ids.length === 1 ? agg.ids[0] : undefined });
        return;
      }
      const { text } = changeSummary(change, lookupCard);
      get().toast({
        kind: 'remote',
        text,
        key,
        agg: { delta: p.summary.copies_delta, ids, count: 1, who: dev.name },
        cardId: ids.length === 1 ? ids[0] : undefined,
        productId: p.product?.id ?? (change.reason === 'product' && change.entity ? change.entity : undefined),
        color: dev.color,
      });
      return;
    }
    const { text, cardIds } = changeSummary(change, lookupCard);
    get().toast({ kind: dev ? 'remote' : 'info', text, cardId: cardIds[0], color: dev?.color });
  }

  function applyChangeNow(change: Change): void {
    const s = get();
    const remote = change.device?.id !== s.me.id;
    switch (change.kind) {
      case 'inventory': {
        const p = change.payload as InventoryPayload;
        get().applyLines(p.lines, change.ts, change.device?.id ?? null);
        if (remote && change.device) pulseCards([...new Set(p.lines.map((l) => l.card_id))], change.device.color);
        if (change.reason === 'product' || change.reason === 'undo') scheduleStateRefetch(400); // purchases list
        break;
      }
      case 'tip': {
        const p = change.payload as TipPayload;
        const prev = s.tips.get(p.card_id);
        get().setTip({
          card_id: p.card_id,
          text: p.text,
          source: 'user',
          model: prev?.model ?? null,
          generated_at: prev?.generated_at ?? null,
          edited_at: change.ts,
          edited_by: change.device?.id ?? null,
        });
        break;
      }
      case 'settings': {
        const p = change.payload as SettingsPayload;
        set({ settings: { ...s.settings, ...p } });
        break;
      }
      case 'catalog':
        scheduleCatalogRefetch();
        scheduleStateRefetch();
        break;
      case 'prices':
      case 'fx':
      case 'tips':
        scheduleStateRefetch();
        break;
    }
    pushRemoteToast(change);
    set({ seq: Math.max(get().seq, change.seq), recentChanges: [change, ...get().recentChanges].slice(0, 100) });
  }

  function drainGapBuffer(): void {
    if (!gapBuffer.length) return;
    gapBuffer.sort((a, b) => a.seq - b.seq);
    const buffered = gapBuffer.splice(0, gapBuffer.length);
    for (const c of buffered) {
      if (c.seq <= get().seq) continue;
      applyChangeNow(c);
    }
  }

  return {
    boot: 'idle',
    bootError: null,
    connection: 'connecting',
    seq: 0,
    catalog_version: 0,
    sets: [],
    cardsById: new Map(),
    cardIds: [],
    products: [],
    decks: [],
    inventory: new Map(),
    pending: new Map(),
    prices: new Map(),
    pricesFetchedAt: null,
    fx: null,
    tips: new Map(),
    devices: [],
    presence: [],
    purchases: [],
    settings: DEFAULT_SETTINGS,
    jobs: [],
    jobLive: {},
    backups: [],
    server: null,
    pulses: new Map(),
    recentChanges: [],
    me: loadIdentity(),
    ui: {
      filters: EMPTY_FILTERS,
      sort: 'number',
      view: readLocal<ViewMode>('rb.view', ['grid', 'list'], 'grid'),
      search: '',
      drawerCardId: null,
      packSet: (() => {
        try {
          return localStorage.getItem('rb.packSet');
        } catch {
          return null;
        }
      })(),
      foilSticky: false,
      helpOpen: false,
    },
    toasts: [],
    liveMessage: '',

    // ---------- boot / sync ----------
    async bootstrap() {
      set({ boot: 'loading', bootError: null });
      try {
        const [cat, st] = await Promise.all([api.catalog(null), api.state()]);
        const patch: Partial<AppStore> = { ...indexState(st), boot: 'ready' };
        if (!cat.notModified) {
          Object.assign(patch, indexCatalog(cat.catalog));
          catalogEtag = cat.etag;
        }
        // state's catalog_version wins if catalog arrived older (rare race) — refetch below
        set(patch);
        if (!cat.notModified && cat.catalog.catalog_version !== st.catalog_version) scheduleCatalogRefetch(0);
      } catch (e) {
        set({ boot: 'error', bootError: errorMessage(e) });
      }
    },

    async refetchState() {
      if (resyncInFlight) return resyncInFlight;
      resyncInFlight = (async () => {
        try {
          const st = await api.state();
          const cur = get();
          // keep server rows, but never regress seq below what we have already applied contiguously
          set({ ...indexState(st), seq: Math.max(st.seq, 0) });
          if (st.catalog_version !== cur.catalog_version) scheduleCatalogRefetch(0);
          drainGapBuffer();
        } catch (e) {
          // network blip: keep what we have, the watchdog will try again
          console.warn('[store] state refetch failed', errorMessage(e));
        } finally {
          resyncInFlight = null;
        }
      })();
      return resyncInFlight;
    },

    async refetchCatalog() {
      try {
        const res = await api.catalog(catalogEtag);
        if (res.notModified) return;
        catalogEtag = res.etag;
        set(indexCatalog(res.catalog));
      } catch (e) {
        console.warn('[store] catalog refetch failed', errorMessage(e));
      }
    },

    async refreshJobs() {
      try {
        const r = await api.jobs();
        set({ jobs: r.jobs, backups: r.backups, server: get().server ? { ...get().server!, images: r.images } : get().server });
      } catch {
        /* ignore */
      }
    },

    ingestChange(change) {
      const s = get();
      if (change.seq <= s.seq) {
        if (change.op_id) optimistic.confirm(change.op_id);
        return;
      }
      if (s.boot !== 'ready') return; // state not loaded yet; bootstrap will catch up
      if (s.seq > 0 && change.seq > s.seq + 1 && !resyncInFlight) {
        // missed something: buffer and resync from a fresh snapshot
        gapBuffer.push(change);
        if (change.op_id) optimistic.confirm(change.op_id);
        void get().refetchState();
        return;
      }
      if (resyncInFlight) {
        gapBuffer.push(change);
        if (change.op_id) optimistic.confirm(change.op_id);
        return;
      }
      applyChangeNow(change);
      if (change.op_id) optimistic.confirm(change.op_id);
    },

    applyLines(lines, ts, by) {
      if (!lines.length) return;
      const next = new Map(get().inventory);
      for (const l of lines) {
        const key = invKey(l.card_id, l.finish);
        next.set(key, { card_id: l.card_id, finish: l.finish, qty: l.qty, note: l.note ?? next.get(key)?.note ?? '', updated_at: ts, updated_by: by });
      }
      set({ inventory: next });
    },

    setConnection(c) {
      if (get().connection !== c) set({ connection: c });
    },
    setPresence(p) {
      set({ presence: p });
    },
    setJobEvent(ev) {
      const s = get();
      const jobs = s.jobs.map((j) => (j.name === ev.job ? { ...j, running: ev.status === 'running' } : j));
      set({ jobLive: { ...s.jobLive, [ev.job]: { ...ev, at: Date.now() } }, jobs });
      if (ev.status !== 'running') scheduleJobsRefresh();
    },
    setServerInstance(instance) {
      const changed = serverInstance !== null && serverInstance !== instance;
      serverInstance = instance;
      gapBuffer.length = 0;
      return changed;
    },

    // ---------- optimistic plumbing ----------
    addPending(deltas) {
      const next = new Map(get().pending);
      for (const [k, d] of deltas) next.set(k, (next.get(k) ?? 0) + d);
      set({ pending: next });
    },
    removePending(deltas) {
      const next = new Map(get().pending);
      for (const [k, d] of deltas) {
        const v = (next.get(k) ?? 0) - d;
        if (v === 0) next.delete(k);
        else next.set(k, v);
      }
      set({ pending: next });
    },
    setLocalNote(cardId, finish, note) {
      const key = invKey(cardId, finish);
      const next = new Map(get().inventory);
      const prev = next.get(key);
      next.set(key, { card_id: cardId, finish, qty: prev?.qty ?? 0, note, updated_at: prev?.updated_at ?? new Date().toISOString(), updated_by: prev?.updated_by ?? null });
      set({ inventory: next });
    },
    setTip(tip) {
      const next = new Map(get().tips);
      next.set(tip.card_id, tip);
      set({ tips: next });
    },

    // ---------- user actions ----------
    adjust(cardId, finish, delta, opts) {
      if (!delta) return Promise.resolve(null);
      return optimistic.adjust(cardId, finish, delta, opts);
    },
    setQty(cardId, finish, qty) {
      optimistic.setQty(cardId, finish, qty);
    },
    setNote(cardId, finish, note) {
      optimistic.setNote(cardId, finish, note);
    },

    async saveTip(cardId, text) {
      try {
        const r = await api.putTip(cardId, text, newOpId());
        get().setTip(r.tip);
        get().ingestChange(r.change);
        return true;
      } catch (e) {
        get().toast({ kind: 'error', text: `Couldn’t save tip: ${errorMessage(e)}`, ttl: 0 });
        return false;
      }
    },

    async undo(seq) {
      try {
        const r = await api.undo(seq, newOpId());
        const p = r.change.payload as InventoryPayload;
        get().applyLines(p.lines, r.change.ts, r.change.device?.id ?? null);
        get().ingestChange(r.change);
        get().toast({ kind: 'success', text: `Undone (${p.lines.length} card${p.lines.length === 1 ? '' : 's'} restored)` });
        return true;
      } catch (e) {
        const msg = isApiError(e) && e.code === 'ALREADY_UNDONE' ? 'That change was already undone.' : `Couldn’t undo: ${errorMessage(e)}`;
        get().toast({ kind: 'error', text: msg, ttl: 5000 });
        return false;
      }
    },

    async registerDevice(name, color) {
      const me = saveIdentity({ name, color });
      set({ me });
      try {
        await api.putDevice(me.id, me.name, me.color);
      } catch (e) {
        get().toast({ kind: 'error', text: `Saved locally, but the server didn’t get your name: ${errorMessage(e)}`, ttl: 6000 });
      }
    },

    async saveSettings(patch) {
      try {
        const r = await api.putSettings(patch, newOpId());
        set({ settings: r.settings });
        return true;
      } catch (e) {
        get().toast({ kind: 'error', text: `Couldn’t save settings: ${errorMessage(e)}`, ttl: 0 });
        return false;
      }
    },

    async runJob(name, force = false) {
      try {
        await api.runJob(name, force);
        const s = get();
        set({ jobs: s.jobs.map((j) => (j.name === name ? { ...j, running: true } : j)), jobLive: { ...s.jobLive, [name]: { job: name, status: 'running', progress: null, message: 'queued', at: Date.now() } } });
        return true;
      } catch (e) {
        const msg = isApiError(e) && e.code === 'JOB_RUNNING' ? `“${name}” is already running.` : `Couldn’t start “${name}”: ${errorMessage(e)}`;
        get().toast({ kind: 'error', text: msg, ttl: 5000 });
        return false;
      }
    },

    async buyProduct(productId, qty) {
      const name = get().products.find((p) => p.id === productId)?.name ?? productId;
      const q = Math.max(1, Math.min(20, Math.floor(qty || 1)));
      try {
        const r = await api.buy(productId, q, newOpId());
        if (!r.change) {
          get().toast({ kind: 'info', text: `Nothing to add for ${name}.` });
          return true;
        }
        const p = r.change.payload as InventoryPayload;
        get().applyLines(p.lines, r.change.ts, r.change.device?.id ?? null);
        get().ingestChange(r.change);
        const seq = r.change.seq;
        const n = p.lines.reduce((a, l) => a + Math.abs(l.qty - l.prev_qty), 0);
        get().toast({
          kind: 'success',
          text: `Added ${name}${q > 1 ? ` ×${q}` : ''} (${n} card${n === 1 ? '' : 's'})`,
          ttl: 8000,
          productId,
          actions: [{ label: 'Undo', run: () => void get().undo(seq) }],
        });
        get().announce(`Added ${name}, ${n} cards`);
        return true;
      } catch (e) {
        const msg = isApiError(e) && e.code === 'NOT_PURCHASABLE' ? `${name} has no fixed card list — open its packs in Pack mode instead.` : `Couldn’t add ${name}: ${errorMessage(e)}`;
        get().toast({ kind: 'error', text: msg, ttl: 0 });
        return false;
      }
    },

    async importCsv({ mode, items, csv_filename }) {
      if (!items.length) return false;
      const chunks: InventoryItem[][] = [];
      for (let i = 0; i < items.length; i += MAX_ITEMS_PER_REQUEST) chunks.push(items.slice(i, i + MAX_ITEMS_PER_REQUEST));
      const seqs: number[] = [];
      let rows = 0;
      let delta = 0;
      const undoAll = () => {
        void (async () => {
          for (const s of [...seqs].reverse()) await get().undo(s);
        })();
      };
      try {
        for (let i = 0; i < chunks.length; i++) {
          // "replace all" zeroes everything not listed in the FIRST chunk; later chunks just set their rows
          const m: InventoryMode = mode === 'replace' && i > 0 ? 'set' : mode;
          const r = await api.inventory({ op_id: newOpId(), reason: 'csv', mode: m, items: chunks[i], csv_filename });
          if (r.change) {
            const p = r.change.payload as InventoryPayload;
            get().applyLines(p.lines, r.change.ts, r.change.device?.id ?? null);
            get().ingestChange(r.change);
            seqs.push(r.change.seq);
            rows += p.lines.length;
            delta += p.summary.copies_delta;
          }
        }
      } catch (e) {
        get().toast({
          kind: 'error',
          text: `CSV import failed${seqs.length ? ` after ${seqs.length} of ${chunks.length} batches` : ''}: ${errorMessage(e)}`,
          ttl: 0,
          actions: seqs.length ? [{ label: 'Undo applied batches', run: undoAll }] : undefined,
        });
        return false;
      }
      const label = csv_filename ? `“${csv_filename}”` : 'CSV';
      if (!seqs.length) {
        get().toast({ kind: 'info', text: `Nothing changed — ${label} already matches your collection.` });
        return true;
      }
      get().toast({
        kind: 'success',
        text: `Imported ${label}: ${rows} row${rows === 1 ? '' : 's'} changed, ${signed(delta)} cop${Math.abs(delta) === 1 ? 'y' : 'ies'}`,
        ttl: 10000,
        actions: [{ label: 'Undo', run: undoAll }],
      });
      get().announce(`CSV imported, ${rows} rows changed`);
      return true;
    },

    // ---------- ui ----------
    setFilters(patch) {
      set({ ui: { ...get().ui, filters: { ...get().ui.filters, ...patch } } });
    },
    resetFilters() {
      set({ ui: { ...get().ui, filters: EMPTY_FILTERS, search: '' } });
    },
    setSearch(q) {
      if (get().ui.search === q) return;
      set({ ui: { ...get().ui, search: q } });
    },
    setSort(s) {
      set({ ui: { ...get().ui, sort: s } });
    },
    setView(v) {
      writeLocal('rb.view', v);
      set({ ui: { ...get().ui, view: v } });
    },
    toggleFoilSticky() {
      const on = !get().ui.foilSticky;
      set({ ui: { ...get().ui, foilSticky: on } });
      get().announce(on ? 'Foil editing on' : 'Foil editing off');
    },
    setPackSet(code) {
      writeLocal('rb.packSet', code);
      set({ ui: { ...get().ui, packSet: code } });
    },
    setHelpOpen(open) {
      set({ ui: { ...get().ui, helpOpen: open } });
    },
    setDrawerCard(id) {
      if (get().ui.drawerCardId === id) return;
      set({ ui: { ...get().ui, drawerCardId: id } });
    },

    // ---------- toasts / a11y ----------
    toast(t) {
      const id = ++toastSeq;
      const ttl = t.ttl ?? (t.kind === 'error' ? 0 : TOAST_TTL);
      const toast: Toast = { ...t, id, at: Date.now(), ttl };
      let next = [...get().toasts, toast];
      while (next.length > MAX_TOASTS) {
        const idx = next.findIndex((x) => x.kind !== 'error');
        next = idx >= 0 ? next.filter((_, i) => i !== idx) : next.slice(1);
      }
      set({ toasts: next });
      return id;
    },
    updateToast(id, patch) {
      set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    },
    dismissToast(id) {
      if (!get().toasts.some((t) => t.id === id)) return;
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    announce(msg) {
      set({ liveMessage: msg });
    },
  };
});

/** Displayed quantity = server quantity + optimistic deltas. */
export function displayedQty(s: Pick<AppStore, 'inventory' | 'pending'>, cardId: string, finish: Finish): number {
  const key = invKey(cardId, finish);
  return (s.inventory.get(key)?.qty ?? 0) + (s.pending.get(key) ?? 0);
}

export function cardName(id: string): string {
  return useStore.getState().cardsById.get(id)?.name ?? id;
}
