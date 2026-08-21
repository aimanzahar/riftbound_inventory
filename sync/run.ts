// CLI: node sync/run.ts <job|all> [--force] [--limit N] [--batch N] [--max-batches N] [--ids a,b] [--dry-run]
import { ensureDataDirs, loadConfig } from '../server/config.ts';
import { openDb } from '../server/db/open.ts';
import { migrate } from '../server/db/migrate.ts';
import { logger } from '../server/log.ts';
import { JobBusyError, isJobName, runJob } from './runner.ts';
import { ALL_ORDER } from './jobs.ts';
import type { JobFlags } from './types.ts';
import { JOB_NAMES, type JobName } from '../shared/constants.ts';

const log = logger('cli');
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags: JobFlags = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = args[i + 1];
  const takesValue = next !== undefined && !next.startsWith('--');
  switch (key) {
    case 'force':
      flags.force = true;
      break;
    case 'dry-run':
      flags.dryRun = true;
      break;
    case 'limit':
    case 'batch':
    case 'max-batches':
      if (takesValue) {
        flags[key === 'max-batches' ? 'maxBatches' : key] = Number(next);
        i++;
      }
      break;
    case 'ids':
      if (takesValue) {
        flags.ids = next.split(',').map((s) => s.trim()).filter(Boolean);
        i++;
      }
      break;
    default:
      if (takesValue) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
  }
}

const target = positional[0];
if (!target || (target !== 'all' && !isJobName(target))) {
  console.error(`Usage: npm run sync -- <${JOB_NAMES.join('|')}|all> [--force] [--limit N] [--batch N] [--max-batches N] [--ids A,B] [--dry-run]`);
  process.exit(2);
}

const cfg = loadConfig([], process.env);
ensureDataDirs(cfg);
const db = openDb(cfg.dbPath);
migrate(db, cfg.migrationsDir);

const jobs: JobName[] = target === 'all' ? ALL_ORDER : [target as JobName];
let exitCode = 0;
for (const name of jobs) {
  try {
    const { status, result } = await runJob(name, { db, cfg, trigger: 'cli', force: Boolean(flags.force), flags });
    console.log(`[${name}] ${status}${result?.message ? ` — ${result.message}` : ''}`);
    if (status === 'error') exitCode = 1;
  } catch (e) {
    if (e instanceof JobBusyError) {
      console.error(`[${name}] busy: ${e.message} (use --force to override)`);
      exitCode = 1;
    } else {
      log.error(`[${name}] crashed`, (e as Error).stack);
      exitCode = 1;
    }
  }
}
db.close();
process.exit(exitCode);
