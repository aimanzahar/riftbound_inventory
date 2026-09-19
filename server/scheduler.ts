import type { Db } from './db/open.ts';
import { one } from './db/open.ts';
import type { Config } from './config.ts';
import { logger } from './log.ts';
import type { Sse } from './http/sse.ts';
import { JobBusyError, isRunning, nextDueAt, runJob } from '../sync/runner.ts';
import { SCHEDULE_ORDER } from '../sync/jobs.ts';
import type { JobName } from '../shared/constants.ts';
import { JOB_INTERVAL_HOURS } from '../shared/constants.ts';

const log = logger('scheduler');

export class Scheduler {
  private queue: { name: JobName; trigger: 'schedule' | 'manual' | 'startup'; force: boolean }[] = [];
  private working = false;
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private db: Db;
  private cfg: Config;
  private sse: Sse;

  constructor(db: Db, cfg: Config, sse: Sse) {
    this.db = db;
    this.cfg = cfg;
    this.sse = sse;
  }

  start(): void {
    if (this.cfg.noScheduler) {
      log.info('disabled (NO_SCHEDULER)');
      return;
    }
    this.startupTimer = setTimeout(() => this.tick('startup'), 15_000);
    this.timer = setInterval(() => this.tick('schedule'), 60_000);
    log.info('started (tick every 60 s, first at +15 s)');
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  isQueued(name: JobName): boolean {
    return this.queue.some((q) => q.name === name) || isRunning(name);
  }

  /** Enqueue a manual run; throws JobBusyError if already queued/running. */
  runNow(name: JobName, force = false): void {
    if (this.isQueued(name) && !force) throw new JobBusyError(name);
    this.queue.push({ name, trigger: 'manual', force });
    void this.pump();
  }

  private tick(trigger: 'schedule' | 'startup'): void {
    const now = Date.now();
    for (const name of SCHEDULE_ORDER) {
      if (JOB_INTERVAL_HOURS[name] === null) continue;
      if (this.isQueued(name)) continue;
      if (name === 'images' && !this.imagesMissing()) continue;
      const due = nextDueAt(this.db, name);
      const emptyCatalog = name === 'cards' && !one(this.db, 'SELECT 1 FROM cards WHERE active=1 LIMIT 1');
      // An empty catalog catches up immediately, but failed attempts still observe retry backoff.
      const last = emptyCatalog ? one<{ status: string }>(this.db, "SELECT status FROM job_runs WHERE job='cards' ORDER BY id DESC LIMIT 1") : null;
      if ((due && Date.parse(due) <= now) || (emptyCatalog && last?.status === 'ok')) {
        this.queue.push({ name, trigger, force: false });
      }
    }
    void this.pump();
  }

  private imagesMissing(): boolean {
    const r = one<{ n: number }>(this.db, `SELECT COUNT(*) AS n FROM cards WHERE active = 1 AND image_url IS NOT NULL`);
    if (!Number(r?.n)) return false;
    // cheap heuristic: the images job itself checks per-file existence; here we just ask it to run once a day
    return true;
  }

  private async pump(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        try {
          const completed = await runJob(item.name, {
            db: this.db,
            cfg: this.cfg,
            trigger: item.trigger,
            force: item.force,
            afterCommit: () => this.sse.drain(),
            onProgress: (ev) => this.sse.emitJob(ev),
          });
          if (item.name === 'cards' && completed.result?.changed && !this.isQueued('images')) {
            this.queue.unshift({ name: 'images', trigger: item.trigger, force: false });
          }
        } catch (e) {
          if (e instanceof JobBusyError) log.warn(e.message);
          else log.error(`unexpected failure in ${item.name}`, (e as Error).stack);
        }
      }
    } finally {
      this.working = false;
    }
  }
}
