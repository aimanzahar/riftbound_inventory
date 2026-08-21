import { useMemo } from 'react';
import { create } from 'zustand';
import type { Card, Finish, InventoryResponse, Price, SetRow } from '../../../../shared/types.ts';
import { packEntryToId, parsePackEntry, type PackEntry } from '../../../../shared/ids.ts';
import { displayedQty, useStore, type AppStore } from '../../store/store.ts';
import { canonicalOf } from '../../store/selectors.ts';
import { invKey } from '../../store/types.ts';
import { fmtInt, fmtMYR, fmtUSD } from '../../lib/format.ts';

/**
 * Pack-mode session state (separate from the main store): the text being typed, the log of
 * entries made in this session, the printing picker and the flash/shake counters.
 * Every inventory mutation still goes through the main store (`adjust` with reason 'pack', `undo`).
 */

export type LogStatus = 'pending' | 'done' | 'failed' | 'undoing' | 'undone';

export interface LogEntry {
  id: number;
  cardId: string;
  finish: Finish;
  qty: number;
  /** displayed qty of that finish right after the entry */
  total: number;
  /** the card (any printing, any finish) was unowned before this entry */
  wasNew: boolean;
  at: number;
  /** server change seq once the op resolved */
  seq: number | null;
  status: LogStatus;
}

export interface Picker {
  /** candidate printings, base printing first */
  ids: string[];
  finish: Finish;
  qty: number;
  index: number;
}

export type Resolution =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'no-set'; set: string }
  | { kind: 'no-card'; id: string; set: string; number: string }
  | { kind: 'match'; entry: PackEntry; set: string; card: Card; candidates: Card[]; ambiguous: boolean };

export interface PackState {
  input: string;
  /** newest first */
  entries: LogEntry[];
  /** id of the most recent commit (drives the flash panel) */
  lastId: number | null;
  /** bumped on every commit (restarts the flash animation) */
  flashN: number;
  /** bumped on every rejected Enter */
  shakeN: number;
  picker: Picker | null;
  startedAt: number | null;

  setInput(v: string): void;
  appendInput(s: string): void;
  /** Backspace: closes the picker, deletes a char, or undoes the last entry when empty */
  backspace(): void;
  shake(): void;
  openPicker(p: Picker): void;
  movePicker(delta: number): void;
  pickIndex(i: number): void;
  closePicker(): void;
  /** Enter: resolve the input (or the picker) and commit */
  submit(): void;
  commit(cardId: string, finish: Finish, qty: number): void;
  undoEntry(id: number): Promise<void>;
  undoLast(): Promise<void>;
  /** a change with `undo_of === seq` arrived (from anyone) */
  markUndoneBySeq(seq: number): void;
  cycleSet(dir: 1 | -1): void;
  /** summary toast + clear the session */
  finishSession(): void;
}

const MAX_LOG = 2000;
const PENDING_WAIT_MS = 1500;
let nextId = 0;
const promises = new Map<number, Promise<InventoryResponse | null>>();

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

type Prefix = PackEntry['prefix'];

function prefixOf(number: string): Prefix {
  const m = number.match(/^(SP|T|R)/);
  return (m ? m[1] : '') as Prefix;
}

function groupKey(set: string, prefix: Prefix, n: number): string {
  return `${set}|${prefix}|${n}`;
}

const indexCache = new WeakMap<Map<string, Card>, Map<string, string[]>>();

/** `${set}|${prefix}|${number_int}` → card ids sharing that number (base printing first). Cached per catalog. */
export function printingsIndex(cardsById: Map<string, Card>): Map<string, string[]> {
  const hit = indexCache.get(cardsById);
  if (hit) return hit;
  const idx = new Map<string, string[]>();
  for (const c of cardsById.values()) {
    const k = groupKey(c.set_code, prefixOf(c.number), c.number_int);
    const arr = idx.get(k);
    if (arr) arr.push(c.id);
    else idx.set(k, [c.id]);
  }
  for (const arr of idx.values()) arr.sort((a, b) => a.length - b.length || a.localeCompare(b));
  indexCache.set(cardsById, idx);
  return idx;
}

/** Resolve the typed text against the catalog. Pure. */
export function resolveInput(text: string, currentSet: string | null, foilSticky: boolean, cardsById: Map<string, Card>, sets: SetRow[]): Resolution {
  const t = text.trim();
  if (!t) return { kind: 'empty' };
  let entry = parsePackEntry(t, foilSticky);
  if (!entry) return { kind: 'invalid' };
  // 'sp1' parses as set 'SP' (2-letter set code wins over the prefix); reinterpret when no such set exists
  if (entry.set_code && !sets.some((s) => s.code === entry!.set_code) && entry.set_code === 'SP' && entry.prefix === '') {
    entry = { ...entry, set_code: null, prefix: 'SP' };
  }
  const set = entry.set_code ?? currentSet;
  if (!set) return { kind: 'invalid' };
  if (!sets.some((s) => s.code === set)) return { kind: 'no-set', set };
  const exactId = packEntryToId(entry, set);
  const number = exactId.slice(set.length + 1);
  const exact = cardsById.get(exactId);
  if (entry.suffix) {
    if (!exact) return { kind: 'no-card', id: exactId, set, number };
    return { kind: 'match', entry, set, card: exact, candidates: [exact], ambiguous: false };
  }
  const group = printingsIndex(cardsById).get(groupKey(set, entry.prefix, entry.number_int)) ?? [];
  const candidates: Card[] = [];
  for (const id of group) {
    const c = cardsById.get(id);
    if (c) candidates.push(c);
  }
  if (exact) {
    const rest = candidates.filter((c) => c.id !== exact.id);
    return { kind: 'match', entry, set, card: exact, candidates: [exact, ...rest], ambiguous: rest.length > 0 };
  }
  if (!candidates.length) return { kind: 'no-card', id: exactId, set, number };
  return { kind: 'match', entry, set, card: candidates[0], candidates, ambiguous: candidates.length > 1 };
}

/** owned copies of a card across all its printings and finishes (incl. optimistic deltas) */
export function canonicalOwned(s: Pick<AppStore, 'cardsById' | 'inventory' | 'pending'>, card: Card): number {
  const canon = canonicalOf(card);
  let n = 0;
  for (const c of s.cardsById.values()) {
    if (canonicalOf(c) !== canon) continue;
    n += displayedQty(s, c.id, 'normal') + displayedQty(s, c.id, 'foil');
  }
  return n;
}

export const VARIANT_LABEL: Record<string, string> = {
  alt_art: 'Alt art',
  showcase: 'Showcase',
  signature: 'Signature',
  overnumbered: 'Overnumbered',
  reprint: 'Reprint',
};

export function printingLabel(card: Card): string {
  return card.variant_kind ? (VARIANT_LABEL[card.variant_kind] ?? card.variant_kind.replace('_', ' ')) : 'Regular';
}

/** Entries that count towards the session (not undone / failed). */
export function isLive(e: LogEntry): boolean {
  return e.status === 'pending' || e.status === 'done' || e.status === 'undoing';
}

export interface SessionStats {
  entries: number;
  cards: number;
  foil: number;
  usd: number;
  myr: number | null;
  unpriced: number;
  newUniques: number;
}

export function computeSession(entries: LogEntry[], cardsById: Map<string, Card>, prices: Map<string, Price>, fxRate: number | null): SessionStats {
  let count = 0,
    cards = 0,
    foil = 0,
    usd = 0,
    unpriced = 0;
  const newCanon = new Set<string>();
  for (const e of entries) {
    if (!isLive(e)) continue;
    count++;
    cards += e.qty;
    if (e.finish === 'foil') foil += e.qty;
    const p = prices.get(invKey(e.cardId, e.finish)) ?? prices.get(invKey(e.cardId, 'normal'));
    const m = p?.usd_market ?? p?.usd_mid ?? null;
    if (m !== null && m !== undefined) usd += m * e.qty;
    else unpriced += e.qty;
    if (e.wasNew) {
      const card = cardsById.get(e.cardId);
      newCanon.add(card ? canonicalOf(card) : e.cardId);
    }
  }
  return {
    entries: count,
    cards,
    foil,
    usd: Math.round(usd * 100) / 100,
    myr: fxRate ? Math.round(usd * fxRate * 100) / 100 : null,
    unpriced,
    newUniques: newCanon.size,
  };
}

export function sessionLine(s: SessionStats): string {
  const parts = [`${fmtInt(s.cards)} card${s.cards === 1 ? '' : 's'}`];
  if (s.myr !== null) parts.push(`≈ ${fmtMYR(s.myr, { compact: true })} (${fmtUSD(s.usd, { compact: true })})`);
  else if (s.usd > 0) parts.push(`≈ ${fmtUSD(s.usd, { compact: true })}`);
  parts.push(`${fmtInt(s.newUniques)} new unique${s.newUniques === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

const TIMEOUT = Symbol('timeout');
function sleep(ms: number): Promise<typeof TIMEOUT> {
  return new Promise((resolve) => window.setTimeout(() => resolve(TIMEOUT), ms));
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const usePack = create<PackState>()((set, get) => {
  function patch(id: number, fn: (e: LogEntry) => LogEntry): void {
    set((s) => ({ entries: s.entries.map((e) => (e.id === id ? fn(e) : e)) }));
  }

  return {
    input: '',
    entries: [],
    lastId: null,
    flashN: 0,
    shakeN: 0,
    picker: null,
    startedAt: null,

    setInput(v) {
      if (get().picker) return; // picker is modal
      set({ input: v });
    },
    appendInput(s) {
      if (get().picker) return;
      set({ input: get().input + s });
    },
    backspace() {
      const s = get();
      if (s.picker) {
        set({ picker: null });
        return;
      }
      if (s.input) {
        set({ input: s.input.slice(0, -1) });
        return;
      }
      void get().undoLast();
    },
    shake() {
      set((s) => ({ shakeN: s.shakeN + 1 }));
    },
    openPicker(p) {
      set({ picker: p });
    },
    movePicker(delta) {
      const p = get().picker;
      if (!p) return;
      const n = p.ids.length;
      set({ picker: { ...p, index: (((p.index + delta) % n) + n) % n } });
    },
    pickIndex(i) {
      const p = get().picker;
      if (!p || i < 0 || i >= p.ids.length) return;
      get().commit(p.ids[i], p.finish, p.qty);
    },
    closePicker() {
      if (get().picker) set({ picker: null });
    },

    submit() {
      const s = get();
      const main = useStore.getState();
      if (s.picker) {
        get().commit(s.picker.ids[s.picker.index], s.picker.finish, s.picker.qty);
        return;
      }
      const r = resolveInput(s.input, main.ui.packSet, main.ui.foilSticky, main.cardsById, main.sets);
      if (r.kind === 'empty') return;
      if (r.kind !== 'match') {
        get().shake();
        main.announce(r.kind === 'no-card' ? `No card ${r.number} in ${r.set}` : r.kind === 'no-set' ? `No set ${r.set}` : 'Not a valid entry');
        return;
      }
      if (r.ambiguous) {
        set({ picker: { ids: r.candidates.map((c) => c.id), finish: r.entry.finish, qty: r.entry.qty, index: 0 } });
        main.announce(`${r.candidates.length} printings of ${r.card.name} — press 1 to ${r.candidates.length} to choose`);
        return;
      }
      get().commit(r.card.id, r.entry.finish, r.entry.qty);
    },

    commit(cardId, finish, qty) {
      const main = useStore.getState();
      const card = main.cardsById.get(cardId);
      if (!card || qty <= 0) return;
      const before = displayedQty(main, cardId, finish);
      const wasNew = canonicalOwned(main, card) === 0;
      const id = ++nextId;
      const p = main.adjust(cardId, finish, qty, { reason: 'pack' });
      const entry: LogEntry = { id, cardId, finish, qty, total: before + qty, wasNew, at: Date.now(), seq: null, status: 'pending' };
      promises.set(id, p);
      set((s) => ({
        entries: [entry, ...s.entries].slice(0, MAX_LOG),
        lastId: id,
        flashN: s.flashN + 1,
        input: '',
        picker: null,
        startedAt: s.startedAt ?? Date.now(),
      }));
      void p.then((res) => {
        promises.delete(id);
        const seq = res?.change?.seq ?? null;
        const landed = Boolean(res && (res.change || res.replayed || res.noop));
        patch(id, (e) => ({ ...e, seq: seq ?? e.seq, status: e.status === 'pending' ? (landed ? 'done' : 'failed') : e.status }));
      });
    },

    async undoEntry(id) {
      const e = get().entries.find((x) => x.id === id);
      if (!e || e.status === 'undone' || e.status === 'undoing') return;
      if (e.status === 'failed') {
        patch(id, (x) => ({ ...x, status: 'undone' })); // nothing reached the server
        return;
      }
      patch(id, (x) => ({ ...x, status: 'undoing' }));
      const main = useStore.getState();
      let seq = e.seq;
      if (seq === null) {
        const p = promises.get(id);
        if (p) {
          const res = await Promise.race([p, sleep(PENDING_WAIT_MS)]);
          if (res === TIMEOUT) {
            // the server hasn't answered yet — apply the inverse delta so the log stays truthful
            void main.adjust(e.cardId, e.finish, -e.qty, { reason: 'pack' });
            patch(id, (x) => ({ ...x, status: 'undone' }));
            return;
          }
          seq = res?.change?.seq ?? null;
        }
        if (seq === null) {
          patch(id, (x) => ({ ...x, status: 'undone' })); // failed / no-op: nothing to undo
          return;
        }
      }
      if (get().entries.find((x) => x.id === id)?.status === 'undone') return; // undone elsewhere meanwhile
      const ok = await main.undo(seq);
      const finalSeq = seq;
      patch(id, (x) => ({ ...x, seq: finalSeq, status: ok ? 'undone' : x.status === 'undone' ? 'undone' : 'done' }));
    },

    async undoLast() {
      const last = get().entries.find((x) => x.status === 'pending' || x.status === 'done');
      if (!last) {
        get().shake();
        return;
      }
      await get().undoEntry(last.id);
    },

    markUndoneBySeq(seq) {
      if (!get().entries.some((x) => x.seq === seq && x.status !== 'undone')) return;
      set((s) => ({ entries: s.entries.map((x) => (x.seq === seq ? { ...x, status: 'undone' } : x)) }));
    },

    cycleSet(dir) {
      const main = useStore.getState();
      const codes = main.sets.map((s) => s.code);
      if (!codes.length) return;
      const i = codes.indexOf(main.ui.packSet ?? '');
      const next = i < 0 ? (dir > 0 ? 0 : codes.length - 1) : (i + dir + codes.length) % codes.length;
      main.setPackSet(codes[next]);
      main.announce(`Set ${codes[next]}`);
    },

    finishSession() {
      const s = get();
      const main = useStore.getState();
      const stats = computeSession(s.entries, main.cardsById, main.prices, main.fx?.rate ?? null);
      if (stats.entries > 0) main.toast({ kind: 'success', text: `Pack session finished: ${sessionLine(stats)}`, ttl: 6000 });
      promises.clear();
      set({ entries: [], lastId: null, picker: null, input: '', startedAt: null });
    },
  };
});

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

export function usePackSession(): SessionStats {
  const entries = usePack((s) => s.entries);
  const cardsById = useStore((s) => s.cardsById);
  const prices = useStore((s) => s.prices);
  const rate = useStore((s) => s.fx?.rate ?? null);
  return useMemo(() => computeSession(entries, cardsById, prices, rate), [entries, cardsById, prices, rate]);
}

/** The live resolution of what is being typed. */
export function useResolution(): Resolution {
  const input = usePack((s) => s.input);
  const packSet = useStore((s) => s.ui.packSet);
  const foilSticky = useStore((s) => s.ui.foilSticky);
  const cardsById = useStore((s) => s.cardsById);
  const sets = useStore((s) => s.sets);
  return useMemo(() => resolveInput(input, packSet, foilSticky, cardsById, sets), [input, packSet, foilSticky, cardsById, sets]);
}
