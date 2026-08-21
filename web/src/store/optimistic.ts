import type { Finish, InventoryPayload, InventoryRequest, InventoryResponse } from '../../../shared/types.ts';
import { api, errorMessage, isApiError, newOpId } from '../lib/api.ts';
import { signed } from '../lib/format.ts';
import { displayedQty, useStore } from './store.ts';
import { invKey } from './types.ts';

/**
 * Optimistic inventory writes.
 *   displayedQty = serverQty + Σ pending deltas
 *   2xx  → apply the returned change (absolute lines), drop the pending delta
 *   4xx  → drop the delta, error toast
 *   network / 5xx → retry with the SAME op_id after 1 s / 3 s / 8 s, then error toast with Retry
 */

interface Op {
  op_id: string;
  req: InventoryRequest;
  deltas: Map<string, number>;
  label: string;
  attempt: number;
  status: 'inflight' | 'waiting' | 'done';
  timer: number | null;
  wake: (() => void) | null;
}

const RETRY_MS = [1000, 3000, 8000];
const ops = new Map<string, Op>();

export function pendingCount(): number {
  return ops.size;
}

function isDone(op: Op): boolean {
  return op.status === 'done';
}

function finish(op: Op): void {
  if (isDone(op)) return;
  op.status = 'done';
  if (op.timer !== null) window.clearTimeout(op.timer);
  op.timer = null;
  op.wake?.();
  op.wake = null;
  ops.delete(op.op_id);
  useStore.getState().removePending(op.deltas);
}

/** Called when the server echoes a change with this op_id (SSE or response). */
export function confirm(opId: string): void {
  const op = ops.get(opId);
  if (op) finish(op);
}

/** Re-send every op that is waiting for its retry timer (after a reconnect). */
export function flush(): void {
  for (const op of ops.values()) if (op.status === 'waiting') op.wake?.();
}

async function attempt(op: Op): Promise<InventoryResponse | null> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isDone(op)) return null;
    op.status = 'inflight';
    try {
      const res = await api.inventory(op.req);
      if (isDone(op)) return res;
      if (res.change) {
        const p = res.change.payload as InventoryPayload;
        const store = useStore.getState();
        store.applyLines(p.lines, res.change.ts, res.change.device?.id ?? null);
        store.ingestChange(res.change);
      }
      finish(op);
      return res;
    } catch (e) {
      if (isDone(op)) return null;
      const store = useStore.getState();
      if (isApiError(e) && !e.retryable) {
        finish(op);
        store.toast({ kind: 'error', text: `Couldn’t save ${op.label}: ${e.message}`, ttl: 0 });
        return null;
      }
      if (op.attempt < RETRY_MS.length) {
        const wait = RETRY_MS[op.attempt++];
        op.status = 'waiting';
        await new Promise<void>((resolve) => {
          op.wake = resolve;
          op.timer = window.setTimeout(resolve, wait);
        });
        if (op.timer !== null) window.clearTimeout(op.timer);
        op.timer = null;
        op.wake = null;
        continue;
      }
      const req = op.req;
      const deltas = op.deltas;
      const label = op.label;
      finish(op);
      store.toast({
        kind: 'error',
        text: `Couldn’t save ${label} — ${errorMessage(e)}`,
        ttl: 0,
        actions: [{ label: 'Retry', run: () => void submit({ ...req, op_id: newOpId() }, deltas, label) }],
      });
      return null;
    }
  }
}

/** Low-level: send an inventory request with optimistic deltas (also used by pack mode / CSV import). */
export function submit(req: InventoryRequest, deltas: Map<string, number>, label: string): Promise<InventoryResponse | null> {
  const op: Op = { op_id: req.op_id, req, deltas, label, attempt: 0, status: 'inflight', timer: null, wake: null };
  ops.set(op.op_id, op);
  useStore.getState().addPending(deltas);
  return attempt(op);
}

function labelFor(cardId: string, finish: Finish, text: string): string {
  const name = useStore.getState().cardsById.get(cardId)?.name ?? cardId;
  return `${text} ${name}${finish === 'foil' ? ' ✦' : ''}`;
}

/** Options for `adjust`: pack mode records reason 'pack' so the server/activity/toasts can tell it apart. */
export interface AdjustOptions {
  reason?: 'manual' | 'pack';
}

export function adjust(cardId: string, finish: Finish, delta: number, opts: AdjustOptions = {}): Promise<InventoryResponse | null> {
  const store = useStore.getState();
  const cur = displayedQty(store, cardId, finish);
  // clamp at 0 locally so the UI never shows a negative; the server clamps too
  const effective = cur + delta < 0 ? -cur : delta;
  if (effective === 0) return Promise.resolve(null);
  const name = store.cardsById.get(cardId)?.name ?? cardId;
  store.announce(`${name}${finish === 'foil' ? ' foil' : ''}: ${cur + effective}`);
  const deltas = new Map([[invKey(cardId, finish), effective]]);
  return submit({ op_id: newOpId(), reason: opts.reason ?? 'manual', mode: 'add', items: [{ card_id: cardId, finish, qty: effective }] }, deltas, labelFor(cardId, finish, signed(effective)));
}

export function setQty(cardId: string, finish: Finish, qty: number): Promise<InventoryResponse | null> {
  const store = useStore.getState();
  const target = Math.max(0, Math.floor(qty));
  const cur = displayedQty(store, cardId, finish);
  const delta = target - cur;
  if (delta === 0) return Promise.resolve(null);
  const name = store.cardsById.get(cardId)?.name ?? cardId;
  store.announce(`${name}${finish === 'foil' ? ' foil' : ''}: ${target}`);
  const deltas = new Map([[invKey(cardId, finish), delta]]);
  return submit({ op_id: newOpId(), reason: 'manual', mode: 'set', items: [{ card_id: cardId, finish, qty: target }] }, deltas, labelFor(cardId, finish, `×${target}`));
}

export function setNote(cardId: string, finish: Finish, note: string): Promise<InventoryResponse | null> {
  const store = useStore.getState();
  store.setLocalNote(cardId, finish, note);
  return submit({ op_id: newOpId(), reason: 'note', mode: 'set', items: [{ card_id: cardId, finish, note }] }, new Map(), labelFor(cardId, finish, 'note on'));
}
