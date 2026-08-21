import type { Db } from '../server/db/open.ts';
import type { Config } from '../server/config.ts';
import type { Logger } from '../server/log.ts';

export interface JobFlags {
  force?: boolean;
  limit?: number;
  batch?: number;
  maxBatches?: number;
  ids?: string[];
  dryRun?: boolean;
  [k: string]: unknown;
}

export interface JobCtx {
  db: Db;
  cfg: Config;
  log: Logger;
  flags: JobFlags;
  trigger: 'schedule' | 'manual' | 'cli' | 'startup';
  signal: AbortSignal;
  /** report progress (forwarded to SSE `job` events when running in-process) */
  progress(done: number, total: number, message?: string): void;
  /** called by the runner after the job returns (server passes sse.drain) */
  afterCommit(): void;
}

export interface JobResult {
  ok: number;
  failed: number;
  message?: string;
  /** set true when the job wrote data (the job itself inserts its `changes` row inside its tx) */
  changed?: boolean;
}

export type JobFn = (ctx: JobCtx) => Promise<JobResult>;

export type JobStatusValue = 'running' | 'ok' | 'partial' | 'error';
