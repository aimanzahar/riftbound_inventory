import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { all, openDb, run } from '../db/open.ts';
import { migrate } from '../db/migrate.ts';
import { Scheduler } from '../scheduler.ts';
import type { Sse } from '../http/sse.ts';
import { JOBS } from '../../sync/jobs.ts';
import { JOB_NAMES, type JobName } from '../../shared/constants.ts';
import { JobBusyError, nextDueAt } from '../../sync/runner.ts';

const now = new Date('2026-09-09T12:00:00Z');
const hour = 3600_000;

function setup(t: TestContext, age = 0, empty = false) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
  const cfg = loadConfig([], {});
  const db = openDb(':memory:');
  migrate(db, cfg.migrationsDir);
  run(db, "INSERT INTO sets(code,name,updated_at) VALUES ('OGN','Origins',?)", now.toISOString());
  if (!empty) run(db, "INSERT INTO cards(id,set_code,number,number_int,name,updated_at) VALUES ('OGN-007','OGN','007',7,'Fury Rune',?)", now.toISOString());
  for (const job of JOB_NAMES) {
    const date = new Date(now.getTime() - (job === 'cards' ? age : 0)).toISOString();
    run(db, "INSERT INTO job_runs(job,trigger,started_at,finished_at,status) VALUES (?,'schedule',?,?,'ok')", job, date, date);
  }
  const calls: JobName[] = [];
  for (const job of JOB_NAMES) t.mock.method(JOBS, job, async () => {
    calls.push(job);
    return { ok: 1, failed: 0, changed: job === 'cards' };
  });
  const sse = { drain() {}, emitJob() {} } as unknown as Sse;
  const scheduler = new Scheduler(db, cfg, sse);
  t.after(() => { scheduler.stop(); db.close(); });
  return { scheduler, db, cfg, calls };
}

test('overdue startup sync runs cards before newly queued images; fresh catalogs wait 24 hours', async (t) => {
  const { scheduler, calls, db } = setup(t, 25 * hour);
  scheduler.start();
  t.mock.timers.tick(15_000);
  await turn();
  assert.deepEqual(calls, ['cards', 'images']);
  assert.equal(all(db, "SELECT * FROM job_runs WHERE job='cards' AND trigger='startup'").length, 1);
  calls.length = 0;
  t.mock.timers.tick(60_000);
  await turn();
  assert.deepEqual(calls, []);
  assert.equal(nextDueAt(db, 'cards'), new Date(now.getTime() + 15_000 + 24 * hour).toISOString());
});

test('empty catalog catches up on startup even after a recent successful run', async (t) => {
  const { scheduler, calls } = setup(t, 0, true);
  scheduler.start();
  t.mock.timers.tick(15_000);
  await turn();
  assert.deepEqual(calls, ['cards', 'images']);
});

test('fresh nonempty catalogs do not run at startup and NO_SCHEDULER disables automation', async (t) => {
  const { scheduler, calls, cfg } = setup(t);
  scheduler.start();
  t.mock.timers.tick(15_000);
  await turn();
  assert.deepEqual(calls, []);
  scheduler.stop();
  cfg.noScheduler = true;
  scheduler.start();
  t.mock.timers.tick(25 * hour);
  await turn();
  assert.deepEqual(calls, []);
});

test('partial and failed card refreshes retry after one hour, including empty catalogs', async (t) => {
  const { scheduler, calls, db } = setup(t, 0, true);
  for (const status of ['partial', 'error']) {
    run(db, "UPDATE job_runs SET status=? WHERE job='cards'", status);
    assert.equal(nextDueAt(db, 'cards'), new Date(now.getTime() + hour).toISOString());
  }
  scheduler.start();
  t.mock.timers.tick(15_000);
  await turn();
  assert.deepEqual(calls, []);
  t.mock.timers.tick(hour);
  await turn();
  assert.deepEqual(calls, ['cards', 'images']);
});

test('manual and scheduled requests cannot duplicate running cards or queued images', async (t) => {
  const { scheduler, calls } = setup(t, 25 * hour);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  t.mock.method(JOBS, 'cards', async () => {
    calls.push('cards');
    await blocked;
    return { ok: 1, failed: 0, changed: true };
  });
  scheduler.start();
  t.mock.timers.tick(15_000);
  assert.throws(() => scheduler.runNow('cards'), JobBusyError);
  scheduler.runNow('images');
  assert.throws(() => scheduler.runNow('images'), JobBusyError);
  t.mock.timers.tick(60_000);
  release();
  await turn();
  assert.deepEqual(calls, ['cards', 'images']);
});

test('stopping the scheduler cancels its pending startup timer', async (t) => {
  const { scheduler, calls } = setup(t, 25 * hour);
  scheduler.start();
  scheduler.stop();
  t.mock.timers.tick(60_000);
  await turn();
  assert.deepEqual(calls, []);
});
