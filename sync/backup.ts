import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import type { JobCtx, JobResult } from './types.ts';
import { ensureDir, listFiles } from './lib/files.ts';

const KEEP_DAILY = 14;
const KEEP_WEEKS = 8;

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, cfg, log } = ctx;
  ensureDir(cfg.backupsDir);
  const suffix = typeof ctx.flags.suffix === 'string' ? ctx.flags.suffix : '';
  const file = path.join(cfg.backupsDir, `app-${stamp()}${suffix}.db`);
  try {
    await sqliteBackup(db.raw, file);
  } catch (e) {
    log.warn(`backup() failed (${(e as Error).message}); falling back to VACUUM INTO`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }
  // verify
  const check = new DatabaseSync(file, { readOnly: true } as never);
  try {
    const r = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (r.integrity_check !== 'ok') throw new Error(`integrity_check: ${r.integrity_check}`);
  } finally {
    check.close();
  }
  const size = fs.statSync(file).size;
  const removed = prune(cfg.backupsDir);
  log.info(`wrote ${path.basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB), pruned ${removed}`);
  return { ok: 1, failed: 0, message: `${path.basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB), pruned ${removed}`, changed: false };
}

/** Keep the newest KEEP_DAILY plus one per ISO week for KEEP_WEEKS weeks; delete the rest (regular backups only). */
function prune(dir: string): number {
  const files = listFiles(dir, /^app-\d{8}-\d{6}\.db$/).sort().reverse(); // newest first
  const keep = new Set<string>(files.slice(0, KEEP_DAILY));
  const weekSeen = new Set<string>();
  const now = Date.now();
  for (const f of files) {
    const m = f.match(/^app-(\d{4})(\d{2})(\d{2})-/);
    if (!m) continue;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const ageWeeks = (now - d.getTime()) / (7 * 86400000);
    if (ageWeeks > KEEP_WEEKS) continue;
    const wk = isoWeek(d);
    if (!weekSeen.has(wk)) {
      weekSeen.add(wk);
      keep.add(f);
    }
  }
  let removed = 0;
  for (const f of files) {
    if (keep.has(f)) continue;
    try {
      fs.unlinkSync(path.join(dir, f));
      removed++;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${week}`;
}
