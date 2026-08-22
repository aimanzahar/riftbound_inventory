// Migration 003 rebuilds the `changes` table to widen its kind CHECK. That is the one destructive step in
// the user-deck feature, so it gets its own test: a v2 database with real rows (including a self-referencing
// undo row) must come through with every row, its seq numbering and its FK graph intact.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, one, all, run, nowIso, type Db } from '../db/open.ts';
import { migrate, pendingMigrations } from '../db/migrate.ts';
import { ROOT_DIR } from './helpers.ts';

const MIGRATIONS_DIR = path.join(ROOT_DIR, 'server', 'db', 'migrations');

/** A migrations dir holding only the files up to `maxVersion`, so we can stop a database at v2. */
function partialMigrations(tmp: string, maxVersion: number): string {
  const dir = path.join(tmp, `migrations-v${maxVersion}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    if (/^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) <= maxVersion) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  }
  return dir;
}

const userVersion = (db: Db) => Number(one<{ user_version: number }>(db, 'PRAGMA user_version')!.user_version);

describe('migrations', { timeout: 60_000 }, () => {
  let tmp: string;
  let db: Db;
  let seqs: number[] = [];

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'riftbound-migrate-'));
    db = openDb(path.join(tmp, 'app.db'));

    // Stop at v2, then fill `changes` with rows the rebuild has to carry over.
    const applied = migrate(db, partialMigrations(tmp, 2));
    assert.equal(userVersion(db), 2, `expected v2, applied ${applied.applied.join(', ')}`);

    db.tx(() => {
      run(db, `INSERT INTO sets(code, name, sort_order, updated_at) VALUES ('OGN','Origins',1,?)`, nowIso());
      run(
        db,
        `INSERT INTO cards(id, set_code, number, number_int, name, type, domains, tags, orientation, has_foil, has_normal, active, updated_at)
         VALUES ('OGN-001','OGN','001',1,'Blazing Scorcher','Unit','[]','[]','portrait',1,1,1,?)`,
        nowIso(),
      );
      const mk = (kind: string, reason: string | null, entity: string | null, undo_of: number | null, opId: string) =>
        Number(
          run(db, `INSERT INTO changes(ts, op_id, device_id, device_name, device_color, kind, reason, entity, undo_of, payload) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            nowIso(), opId, 'dev-1', 'Tester', '#22c55e', kind, reason, entity, undo_of, JSON.stringify({ note: opId })).lastInsertRowid,
        );
      const a = mk('inventory', 'manual', 'OGN-001', null, 'op-a');
      const b = mk('inventory', 'csv', null, null, 'op-b');
      const c = mk('inventory', 'undo', 'OGN-001', a, 'op-c'); // self-referencing FK — the interesting row
      const d = mk('settings', null, null, null, 'op-d');
      seqs = [a, b, c, d];
    });
  });

  after(() => {
    db?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('003 is pending at v2 and rejects the deck kind beforehand', () => {
    assert.equal(pendingMigrations(db, MIGRATIONS_DIR) >= 1, true);
    assert.throws(() => run(db, `INSERT INTO changes(ts, kind, payload) VALUES (?, 'deck', '{}')`, nowIso()), /CHECK|constraint/i);
  });

  it('carries every change row, its seq and its undo link through the rebuild', () => {
    const before = all<{ seq: number; kind: string; reason: string | null; entity: string | null; undo_of: number | null; op_id: string; payload: string }>(
      db,
      'SELECT seq, kind, reason, entity, undo_of, op_id, payload FROM changes ORDER BY seq',
    );

    const res = migrate(db, MIGRATIONS_DIR);
    assert.ok(res.applied.includes('003_user_decks.sql'), `applied: ${res.applied.join(', ')}`);
    assert.equal(userVersion(db), 3);

    const after = all<typeof before extends (infer T)[] ? T : never>(db, 'SELECT seq, kind, reason, entity, undo_of, op_id, payload FROM changes ORDER BY seq');
    assert.deepEqual(after, before, 'every column of every row survives byte for byte');
    assert.deepEqual(after.map((r) => Number(r.seq)), seqs);
    assert.equal(Number(after.find((r) => r.op_id === 'op-c')!.undo_of), seqs[0], 'undo_of still points at the original row');
  });

  it('leaves the schema sound: FKs, integrity and indexes', () => {
    assert.deepEqual(all(db, 'PRAGMA foreign_key_check'), []);
    assert.equal(one<{ integrity_check: string }>(db, 'PRAGMA integrity_check')!.integrity_check, 'ok');

    const idx = all<{ name: string }>(db, `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='changes' AND name LIKE 'idx_%' ORDER BY name`).map((r) => r.name);
    assert.deepEqual(idx, ['idx_changes_entity', 'idx_changes_kind', 'idx_changes_undo']);

    const tables = all<{ name: string }>(db, `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('changes','changes_new','user_decks','user_deck_cards') ORDER BY name`).map((r) => r.name);
    assert.deepEqual(tables, ['changes', 'user_deck_cards', 'user_decks'], 'changes_new was renamed away');
  });

  it('keeps AUTOINCREMENT running past the highest existing seq', () => {
    const max = Math.max(...seqs);
    assert.equal(Number(one<{ seq: number }>(db, `SELECT seq FROM sqlite_sequence WHERE name = 'changes'`)!.seq), max);
    const next = Number(run(db, `INSERT INTO changes(ts, op_id, kind, reason, entity, payload) VALUES (?, 'op-deck', 'deck', 'create', 'deck-1', '{}')`, nowIso()).lastInsertRowid);
    assert.equal(next, max + 1, 'no seq reuse — SSE clients track this number');
  });

  it('still rejects an unknown kind after widening', () => {
    assert.throws(() => run(db, `INSERT INTO changes(ts, kind, payload) VALUES (?, 'bogus', '{}')`, nowIso()), /CHECK|constraint/i);
  });

  it('cascades user_deck_cards when a deck is deleted', () => {
    db.tx(() => {
      run(db, `INSERT INTO user_decks(id, name, notes, archived, created_at, updated_at) VALUES ('d1','Test','',0,?,?)`, nowIso(), nowIso());
      run(db, `INSERT INTO user_deck_cards(deck_id, card_id, section, qty) VALUES ('d1','OGN-001','main',3)`);
    });
    assert.equal(Number(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM user_deck_cards')!.n), 1);
    assert.throws(() => run(db, `INSERT INTO user_deck_cards(deck_id, card_id, section, qty) VALUES ('d1','OGN-001','champion',0)`), /CHECK|constraint/i, 'qty > 0 enforced');
    run(db, `DELETE FROM user_decks WHERE id = 'd1'`);
    assert.equal(Number(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM user_deck_cards')!.n), 0, 'lines cascade away');
  });

  it('is idempotent — re-running applies nothing', () => {
    assert.equal(pendingMigrations(db, MIGRATIONS_DIR), 0);
    assert.deepEqual(migrate(db, MIGRATIONS_DIR).applied, []);
  });
});
