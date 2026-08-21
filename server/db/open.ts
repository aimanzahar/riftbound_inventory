import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface Db {
  raw: DatabaseSync;
  /** Run fn inside BEGIN IMMEDIATE … COMMIT (re-entrant: nested calls join the outer tx). */
  tx<T>(fn: () => T): T;
  /** Read-only snapshot tx (BEGIN DEFERRED). */
  read<T>(fn: () => T): T;
  close(): void;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function openDb(dbPath: string, opts: { readOnly?: boolean } = {}): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw = new DatabaseSync(dbPath, { readOnly: opts.readOnly ?? false, timeout: 5000 } as never);
  if (!opts.readOnly) {
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA synchronous = NORMAL');
  }
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  raw.exec('PRAGMA temp_store = MEMORY');

  let depth = 0;
  function transact<T>(mode: 'IMMEDIATE' | 'DEFERRED', fn: () => T): T {
    if (depth > 0) return fn();
    depth++;
    raw.exec(`BEGIN ${mode}`);
    try {
      const r = fn();
      raw.exec('COMMIT');
      return r;
    } catch (e) {
      try {
        raw.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      depth--;
    }
  }
  return {
    raw,
    tx: (fn) => transact('IMMEDIATE', fn),
    read: (fn) => transact('DEFERRED', fn),
    close: () => raw.close(),
  };
}

/** Small helpers over prepared statements (node:sqlite returns null-prototype objects). */
export function one<T = Record<string, unknown>>(db: Db, sql: string, ...params: unknown[]): T | undefined {
  return db.raw.prepare(sql).get(...(params as never[])) as T | undefined;
}
export function all<T = Record<string, unknown>>(db: Db, sql: string, ...params: unknown[]): T[] {
  return db.raw.prepare(sql).all(...(params as never[])) as T[];
}
export function run(db: Db, sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  const r = db.raw.prepare(sql).run(...(params as never[]));
  return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}
export function setSetting(db: Db, key: string, value: unknown): void {
  run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}
export function bumpCatalogVersion(db: Db): number {
  const v = getSetting<number>(db, 'catalog_version', 1) + 1;
  setSetting(db, 'catalog_version', v);
  return v;
}
