import type { Db } from '../db/open.ts';
import { all, nowIso, one, run } from '../db/open.ts';
import type { Change, ChangeKind, ChangePayload, DeviceRef, PurchaseRecord } from '../../shared/types.ts';

export interface ChangeRow {
  seq: number;
  ts: string;
  op_id: string | null;
  device_id: string | null;
  device_name: string | null;
  device_color: string | null;
  kind: ChangeKind;
  reason: string | null;
  entity: string | null;
  undo_of: number | null;
  payload: string;
  undone?: number;
}

const SELECT = `SELECT c.*, EXISTS(SELECT 1 FROM changes u WHERE u.undo_of = c.seq) AS undone FROM changes c`;

export function rowToChange(r: ChangeRow): Change {
  return {
    seq: Number(r.seq),
    ts: r.ts,
    op_id: r.op_id,
    device: r.device_id ? { id: r.device_id, name: r.device_name ?? 'Unknown', color: r.device_color ?? '#6b7280' } : null,
    kind: r.kind,
    reason: r.reason,
    entity: r.entity,
    undo_of: r.undo_of === null ? null : Number(r.undo_of),
    payload: JSON.parse(r.payload) as ChangePayload,
    undone: Boolean(r.undone),
  };
}

export function maxSeq(db: Db): number {
  const r = one<{ m: number | null }>(db, 'SELECT MAX(seq) AS m FROM changes');
  return Number(r?.m ?? 0);
}

export function resolveDevice(db: Db, deviceId: string | null | undefined): DeviceRef | null {
  if (!deviceId) return null;
  const d = one<{ id: string; name: string; color: string }>(db, 'SELECT id, name, color FROM devices WHERE id = ?', deviceId);
  if (d) {
    run(db, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', nowIso(), deviceId);
    return { id: d.id, name: d.name, color: d.color };
  }
  return { id: deviceId, name: 'Unknown', color: '#6b7280' };
}

export interface InsertChangeArgs {
  op_id?: string | null;
  device?: DeviceRef | null;
  kind: ChangeKind;
  reason?: string | null;
  entity?: string | null;
  undo_of?: number | null;
  payload: ChangePayload;
}

/** Must be called inside a tx. */
export function insertChange(db: Db, a: InsertChangeArgs): Change {
  const ts = nowIso();
  const r = run(
    db,
    `INSERT INTO changes(ts, op_id, device_id, device_name, device_color, kind, reason, entity, undo_of, payload)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ts,
    a.op_id ?? null,
    a.device?.id ?? null,
    a.device?.name ?? null,
    a.device?.color ?? null,
    a.kind,
    a.reason ?? null,
    a.entity ?? null,
    a.undo_of ?? null,
    JSON.stringify(a.payload),
  );
  return {
    seq: Number(r.lastInsertRowid),
    ts,
    op_id: a.op_id ?? null,
    device: a.device ?? null,
    kind: a.kind,
    reason: a.reason ?? null,
    entity: a.entity ?? null,
    undo_of: a.undo_of ?? null,
    payload: a.payload,
    undone: false,
  };
}

export function findByOpId(db: Db, opId: string): Change | undefined {
  const r = one<ChangeRow>(db, `${SELECT} WHERE c.op_id = ?`, opId);
  return r ? rowToChange(r) : undefined;
}

export function getChange(db: Db, seq: number): Change | undefined {
  const r = one<ChangeRow>(db, `${SELECT} WHERE c.seq = ?`, seq);
  return r ? rowToChange(r) : undefined;
}

export function isUndone(db: Db, seq: number): boolean {
  return Boolean(one<{ x: number }>(db, 'SELECT 1 AS x FROM changes WHERE undo_of = ? LIMIT 1', seq));
}

export interface ListChangesOpts {
  limit?: number;
  before?: number;
  after?: number;
  kind?: string;
  reason?: string;
  card_id?: string;
  entity?: string;
}

export function listChanges(db: Db, o: ListChangesOpts = {}): Change[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (o.before) {
    where.push('c.seq < ?');
    params.push(o.before);
  }
  if (o.after) {
    where.push('c.seq > ?');
    params.push(o.after);
  }
  if (o.kind) {
    where.push('c.kind = ?');
    params.push(o.kind);
  }
  if (o.reason) {
    where.push('c.reason = ?');
    params.push(o.reason);
  }
  if (o.entity) {
    where.push('c.entity = ?');
    params.push(o.entity);
  }
  if (o.card_id) {
    where.push(`(c.entity = ? OR (c.kind = 'inventory' AND EXISTS (SELECT 1 FROM json_each(c.payload, '$.lines') je WHERE json_extract(je.value, '$.card_id') = ?)))`);
    params.push(o.card_id, o.card_id);
  }
  const limit = Math.min(Math.max(1, o.limit ?? 50), 500);
  const order = o.after ? 'ASC' : 'DESC';
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.seq ${order} LIMIT ${limit}`;
  return all<ChangeRow>(db, sql, ...params).map(rowToChange);
}

export function changesAfter(db: Db, seq: number, limit = 1000): Change[] {
  return all<ChangeRow>(db, `${SELECT} WHERE c.seq > ? ORDER BY c.seq ASC LIMIT ${limit}`, seq).map(rowToChange);
}

export function listPurchases(db: Db, limit = 100): PurchaseRecord[] {
  const rows = all<ChangeRow>(
    db,
    `${SELECT} WHERE c.kind = 'inventory' AND c.reason = 'product' ORDER BY c.seq DESC LIMIT ${Math.min(limit, 500)}`,
  );
  return rows.map((r) => {
    const c = rowToChange(r);
    const p = (c.payload as { product?: { id: string; qty: number } }).product;
    return {
      seq: c.seq,
      ts: c.ts,
      device: c.device,
      product_id: p?.id ?? c.entity ?? '',
      qty: p?.qty ?? 1,
      undone: c.undone,
    };
  });
}

export function timesBought(db: Db, productId: string): { count: number; last: { ts: string; device_name: string | null } | null } {
  const rows = all<{ ts: string; device_name: string | null }>(
    db,
    `SELECT c.ts, c.device_name FROM changes c
     WHERE c.kind='inventory' AND c.reason='product' AND c.entity = ?
       AND NOT EXISTS (SELECT 1 FROM changes u WHERE u.undo_of = c.seq)
     ORDER BY c.seq DESC`,
    productId,
  );
  return { count: rows.length, last: rows[0] ? { ts: rows[0].ts, device_name: rows[0].device_name } : null };
}
