import type { Db } from '../server/db/open.ts';
import { all, nowIso, one, run } from '../server/db/open.ts';
import type { Config } from '../server/config.ts';
import { logger } from '../server/log.ts';
import type { JobFlags, JobFn, JobResult, JobStatusValue } from './types.ts';
import { JOBS } from './jobs.ts';
import type { JobName } from '../shared/constants.ts';
import { JOB_INTERVAL_HOURS, JOB_NAMES } from '../shared/constants.ts';
import type { JobStatus } from '../shared/types.ts';

const inMemoryRunning = new Set<string>();
const STALE_MS = 2 * 60 * 60 * 1000;
const CAP_MS = 30 * 60 * 1000;

export interface RunOpts {
  db: Db;
  cfg: Config;
  trigger: 'schedule' | 'manual' | 'cli' | 'startup';
  force?: boolean;
  flags?: JobFlags;
  afterCommit?: () => void;
  onProgress?: (ev: { job: string; status: JobStatusValue; progress: { done: number; total: number } | null; message: string | null }) => void;
}

export class JobBusyError extends Error {
  constructor(job: string) {
    super(`Job "${job}" is already running`);
  }
}

export function isJobName(s: string): s is JobName {
  return (JOB_NAMES as readonly string[]).includes(s);
}

export function isRunning(name: string): boolean {
  return inMemoryRunning.has(name);
}

/** Runs a job with bookkeeping in job_runs. Never throws for job failures (returns status); throws JobBusyError if busy. */
export async function runJob(name: JobName, o: RunOpts): Promise<{ status: JobStatusValue; result: JobResult | null; runId: number }> {
  const { db, cfg } = o;
  const log = logger(`job:${name}`);
  const job: JobFn | undefined = JOBS[name];
  if (!job) throw new Error(`Unknown job ${name}`);

  // locks
  if (inMemoryRunning.has(name) && !o.force) throw new JobBusyError(name);
  const running = one<{ id: number; started_at: string }>(db, `SELECT id, started_at FROM job_runs WHERE job = ? AND status = 'running' ORDER BY id DESC LIMIT 1`, name);
  if (running) {
    const age = Date.now() - Date.parse(running.started_at);
    if (age < STALE_MS && !o.force) throw new JobBusyError(name);
    run(db, `UPDATE job_runs SET status='error', finished_at=?, message=? WHERE id=?`, nowIso(), 'stale lock (superseded)', running.id);
  }

  inMemoryRunning.add(name);
  const started = nowIso();
  const runId = Number(run(db, `INSERT INTO job_runs(job, trigger, started_at, status) VALUES (?,?,?,'running')`, name, o.trigger, started).lastInsertRowid);
  o.onProgress?.({ job: name, status: 'running', progress: null, message: 'started' });

  const ac = new AbortController();
  const cap = setTimeout(() => ac.abort(new Error('job exceeded 30 minute cap')), CAP_MS);
  let status: JobStatusValue = 'error';
  let result: JobResult | null = null;
  try {
    result = await job({
      db,
      cfg,
      log,
      flags: o.flags ?? {},
      trigger: o.trigger,
      signal: ac.signal,
      progress: (done, total, message) => o.onProgress?.({ job: name, status: 'running', progress: { done, total }, message: message ?? null }),
      afterCommit: () => o.afterCommit?.(),
    });
    status = result.failed > 0 ? (result.ok > 0 ? 'partial' : 'error') : 'ok';
    if (result.failed === 0 && result.ok === 0 && result.message?.toLowerCase().startsWith('error')) status = 'error';
  } catch (e) {
    status = 'error';
    result = { ok: 0, failed: 1, message: `error: ${(e as Error).message}` };
    log.error('failed', (e as Error).stack ?? (e as Error).message);
  } finally {
    clearTimeout(cap);
    inMemoryRunning.delete(name);
  }
  run(
    db,
    `UPDATE job_runs SET finished_at=?, status=?, items_ok=?, items_failed=?, message=? WHERE id=?`,
    nowIso(),
    status,
    result?.ok ?? 0,
    result?.failed ?? 0,
    (result?.message ?? '').slice(0, 4000),
    runId,
  );
  // prune
  run(db, `DELETE FROM job_runs WHERE job = ? AND id NOT IN (SELECT id FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 200)`, name, name);
  o.afterCommit?.();
  o.onProgress?.({ job: name, status, progress: null, message: result?.message ?? null });
  log.info(`${status}: ok=${result?.ok ?? 0} failed=${result?.failed ?? 0} ${result?.message ?? ''}`);
  return { status, result, runId };
}

export function lastRun(db: Db, name: string) {
  return one<{ status: JobStatusValue; trigger: string; started_at: string; finished_at: string | null; items_ok: number; items_failed: number; message: string | null }>(
    db,
    `SELECT status, trigger, started_at, finished_at, items_ok, items_failed, message FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1`,
    name,
  );
}

export function lastGoodRun(db: Db, name: string) {
  return one<{ started_at: string; finished_at: string | null }>(db, `SELECT started_at, finished_at FROM job_runs WHERE job = ? AND status IN ('ok','partial') ORDER BY id DESC LIMIT 1`, name);
}

/** Compute when a scheduled job is next due (null for manual-only jobs). */
export function nextDueAt(db: Db, name: JobName): string | null {
  const interval = JOB_INTERVAL_HOURS[name];
  if (interval === null) return null;
  const last = lastRun(db, name);
  if (!last) return nowIso();
  const base = Date.parse(last.finished_at ?? last.started_at);
  if (last.status === 'error' || (name === 'cards' && last.status === 'partial')) return new Date(base + 60 * 60 * 1000).toISOString();
  const good = lastGoodRun(db, name);
  if (!good) return nowIso();
  return new Date(Date.parse(good.finished_at ?? good.started_at) + interval * 3600 * 1000).toISOString();
}

export function jobStatuses(db: Db): JobStatus[] {
  return JOB_NAMES.map((name) => {
    const last = lastRun(db, name);
    const good = lastGoodRun(db, name);
    return {
      name,
      interval_hours: JOB_INTERVAL_HOURS[name],
      running: inMemoryRunning.has(name) || last?.status === 'running',
      next_due_at: nextDueAt(db, name),
      last_success_at: good ? (good.finished_at ?? good.started_at) : null,
      last: last
        ? { status: last.status, trigger: last.trigger, started_at: last.started_at, finished_at: last.finished_at, items_ok: Number(last.items_ok), items_failed: Number(last.items_failed), message: last.message }
        : null,
    };
  });
}

export function recentRuns(db: Db, name: string, limit = 20) {
  return all(db, `SELECT id, job, trigger, started_at, finished_at, status, items_ok, items_failed, message FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT ?`, name, limit);
}
