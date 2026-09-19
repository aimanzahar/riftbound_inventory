import type { Db } from '../db/open.ts';
import { all, nowIso, one, run } from '../db/open.ts';
import { HttpError } from '../http/body.ts';
import { FINISHES, MAX_ITEMS_PER_REQUEST, MAX_QTY } from '../../shared/constants.ts';
import type {
  Change,
  DeviceRef,
  Finish,
  InvLine,
  InventoryItem,
  InventoryMode,
  InventoryPayload,
  InventoryReason,
  InventoryResponse,
} from '../../shared/types.ts';
import { findByOpId, getChange, insertChange, isUndone } from './changes.ts';
import { normalizeCommunityId } from '../../shared/ids.ts';

interface InvRow {
  qty: number;
  note: string;
}

export interface ApplyArgs {
  op_id: string;
  reason: InventoryReason;
  mode: InventoryMode;
  items: InventoryItem[];
  device: DeviceRef | null;
  entity?: string | null;
  product?: { id: string; name: string; qty: number };
  csv_filename?: string;
  undo_of?: number | null;
}

const OP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function validateOpId(op_id: unknown): string {
  if (typeof op_id !== 'string' || !OP_ID_RE.test(op_id)) throw new HttpError(400, 'VALIDATION', 'op_id must be an 8-64 char id');
  return op_id;
}

/** Case-normalise a card id the way the catalog stores it: 'ogn-036A' → 'OGN-036a' (set/prefix upper, variant suffix lower). */
export function normalizeCardId(raw: string): string {
  return normalizeCommunityId(raw) ?? raw.trim().toUpperCase();
}

function validateItems(mode: InventoryMode, items: unknown): InventoryItem[] {
  if (!Array.isArray(items)) throw new HttpError(400, 'VALIDATION', 'items must be an array');
  if (items.length === 0) throw new HttpError(400, 'VALIDATION', 'items must not be empty');
  if (items.length > MAX_ITEMS_PER_REQUEST) throw new HttpError(400, 'VALIDATION', `at most ${MAX_ITEMS_PER_REQUEST} items per request`);
  const out = new Map<string, InventoryItem>();
  for (const raw of items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'VALIDATION', 'item must be an object');
    const card_id = typeof raw.card_id === 'string' ? normalizeCardId(raw.card_id) : '';
    if (!card_id) throw new HttpError(400, 'VALIDATION', 'item.card_id required');
    const finish = (raw.finish ?? 'normal') as Finish;
    if (!FINISHES.includes(finish)) throw new HttpError(400, 'VALIDATION', `item.finish must be one of ${FINISHES.join('|')}`, { card_id });
    let qty: number | undefined;
    if (raw.qty !== undefined && raw.qty !== null) {
      qty = Number(raw.qty);
      if (!Number.isInteger(qty)) throw new HttpError(400, 'VALIDATION', 'item.qty must be an integer', { card_id });
      if (mode === 'add' ? Math.abs(qty) > MAX_QTY : qty < 0 || qty > MAX_QTY)
        throw new HttpError(400, 'VALIDATION', `item.qty out of range (max ${MAX_QTY})`, { card_id });
    }
    let note: string | undefined;
    if (raw.note !== undefined && raw.note !== null) {
      if (typeof raw.note !== 'string') throw new HttpError(400, 'VALIDATION', 'item.note must be a string', { card_id });
      note = raw.note.slice(0, 500);
    }
    if (qty === undefined && note === undefined) throw new HttpError(400, 'VALIDATION', 'item needs qty and/or note', { card_id });
    const key = `${card_id}:${finish}`;
    const prev = out.get(key);
    if (prev) {
      if (mode !== 'add') throw new HttpError(400, 'VALIDATION', `duplicate item for ${card_id} (${finish})`, { card_id });
      prev.qty = (prev.qty ?? 0) + (qty ?? 0);
      if (note !== undefined) prev.note = note;
    } else {
      out.set(key, { card_id, finish, qty, note });
    }
  }
  return [...out.values()];
}

function ensureCardsExist(db: Db, ids: string[]): void {
  const unknown: string[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const placeholders = chunk.map(() => '?').join(',');
    const found = new Set(all<{ id: string }>(db, `SELECT id FROM cards WHERE id IN (${placeholders})`, ...chunk).map((r) => r.id));
    for (const id of chunk) if (!found.has(id)) unknown.push(id);
  }
  if (unknown.length) throw new HttpError(400, 'VALIDATION', `Unknown card ids: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}`, { unknown_ids: unknown });
}

function getRow(db: Db, card_id: string, finish: Finish): InvRow {
  const r = one<InvRow>(db, 'SELECT qty, note FROM inventory WHERE card_id = ? AND finish = ?', card_id, finish);
  return r ? { qty: Number(r.qty), note: r.note } : { qty: 0, note: '' };
}

function upsertRow(db: Db, card_id: string, finish: Finish, qty: number, note: string, device: DeviceRef | null): void {
  run(
    db,
    `INSERT INTO inventory(card_id, finish, qty, note, updated_at, updated_by) VALUES (?,?,?,?,?,?)
     ON CONFLICT(card_id, finish) DO UPDATE SET qty=excluded.qty, note=excluded.note, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    card_id,
    finish,
    qty,
    note,
    nowIso(),
    device?.id ?? null,
  );
}

/** THE single write path for inventory. Runs in its own tx; idempotent by op_id. */
export function applyInventory(db: Db, a: ApplyArgs): InventoryResponse {
  const op_id = validateOpId(a.op_id);
  if (!['add', 'set', 'replace'].includes(a.mode)) throw new HttpError(400, 'VALIDATION', 'mode must be add|set|replace');
  const items = validateItems(a.mode, a.items);

  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { replayed: true as const, change: replay };

    ensureCardsExist(
      db,
      items.map((i) => i.card_id),
    );

    const lines: InvLine[] = [];
    let clamped = 0;
    let copiesDelta = 0;
    const touched = new Set<string>();

    for (const it of items) {
      const prev = getRow(db, it.card_id, it.finish);
      let qty = prev.qty;
      if (it.qty !== undefined) {
        if (a.mode === 'add') {
          const next = prev.qty + it.qty;
          if (next < 0) {
            clamped++;
            qty = 0;
          } else qty = Math.min(next, MAX_QTY);
        } else qty = it.qty;
      }
      const note = it.note !== undefined ? it.note : prev.note;
      // a delta that was clamped at 0 is still reported as a line (clamped: true) even if qty did not move
      const wasClamped = a.mode === 'add' && it.qty !== undefined && prev.qty + it.qty < 0;
      touched.add(`${it.card_id}:${it.finish}`);
      if (qty === prev.qty && note === prev.note && !wasClamped) continue;
      upsertRow(db, it.card_id, it.finish, qty, note, a.device);
      const line: InvLine = { card_id: it.card_id, finish: it.finish, qty, prev_qty: prev.qty, note };
      if (note !== prev.note) line.prev_note = prev.note;
      if (wasClamped) line.clamped = true;
      copiesDelta += qty - prev.qty;
      lines.push(line);
    }

    if (a.mode === 'replace') {
      const others = all<{ card_id: string; finish: Finish; qty: number; note: string }>(db, 'SELECT card_id, finish, qty, note FROM inventory WHERE qty > 0');
      for (const o of others) {
        if (touched.has(`${o.card_id}:${o.finish}`)) continue;
        upsertRow(db, o.card_id, o.finish, 0, o.note, a.device);
        lines.push({ card_id: o.card_id, finish: o.finish, qty: 0, prev_qty: Number(o.qty), note: o.note });
        copiesDelta -= Number(o.qty);
      }
    }

    if (lines.length === 0 && !a.undo_of) return { noop: true as const };

    const payload: InventoryPayload = {
      mode: a.mode,
      lines,
      summary: { cards: lines.length, copies_delta: copiesDelta, clamped },
    };
    if (a.product) payload.product = a.product;
    if (a.csv_filename) payload.csv_filename = a.csv_filename;

    const change = insertChange(db, {
      op_id,
      device: a.device,
      kind: 'inventory',
      reason: a.reason,
      entity: a.entity ?? (lines.length === 1 ? lines[0].card_id : null),
      undo_of: a.undo_of ?? null,
      payload,
    });
    return { change };
  });
}

/** Undo an inventory change by applying inverse deltas (clamped at 0) and restoring notes. */
export function undoChange(db: Db, seq: number, op_id: string, device: DeviceRef | null): { change: Change } {
  validateOpId(op_id);
  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { change: replay };
    const target = getChange(db, seq);
    if (!target) throw new HttpError(404, 'NOT_FOUND', `Change ${seq} not found`);
    if (target.kind !== 'inventory') throw new HttpError(409, 'NOT_UNDOABLE', 'Only inventory changes can be undone');
    if (isUndone(db, seq)) throw new HttpError(409, 'ALREADY_UNDONE', `Change ${seq} was already undone`);
    const p = target.payload as InventoryPayload;
    const items: InventoryItem[] = p.lines.map((l) => {
      const it: InventoryItem = { card_id: l.card_id, finish: l.finish, qty: l.prev_qty - l.qty };
      if (l.prev_note !== undefined) it.note = l.prev_note;
      if (it.qty === 0) delete it.qty;
      if (it.qty === undefined && it.note === undefined) it.qty = 0; // keeps item valid; no-op line
      return it;
    });
    if (items.length === 0) {
      // Nothing to invert (empty change); still record the undo so it reads as undone.
      const change = insertChange(db, {
        op_id,
        device,
        kind: 'inventory',
        reason: 'undo',
        entity: target.entity,
        undo_of: seq,
        payload: { mode: 'add', lines: [], summary: { cards: 0, copies_delta: 0, clamped: 0 } },
      });
      return { change };
    }
    const res = applyInventory(db, {
      op_id,
      reason: 'undo',
      mode: 'add',
      items,
      device,
      entity: target.entity,
      product: p.product,
      undo_of: seq,
    });
    if (!res.change) throw new HttpError(500, 'INTERNAL', 'Undo produced no change');
    return { change: res.change };
  });
}
