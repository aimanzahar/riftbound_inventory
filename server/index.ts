import http from 'node:http';
import { ensureDataDirs, loadConfig, ROOT_DIR } from './config.ts';
import { logger } from './log.ts';
import { lanUrls } from './lan.ts';
import { openDb } from './db/open.ts';
import { migrate, pendingMigrations } from './db/migrate.ts';
import { Sse } from './http/sse.ts';
import { serveDist, serveImage } from './http/static.ts';
import { createViteDev, type DevMiddleware } from './http/vite-dev.ts';
import { createApi } from './routes/api.ts';
import { Scheduler } from './scheduler.ts';
import { sendError } from './http/body.ts';

const log = logger('server');
const cfg = loadConfig();
ensureDataDirs(cfg);

const db = openDb(cfg.dbPath);
if (pendingMigrations(db, cfg.migrationsDir) > 0) {
  // backup before migrating an existing DB
  try {
    const hasTables = (db.raw.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`).get() as { n: number }).n > 0;
    if (hasTables) {
      const { run: backupRun } = await import('../sync/backup.ts');
      await backupRun({ db, cfg, log: logger('backup'), flags: { suffix: '-pre-migrate' }, trigger: 'startup', signal: new AbortController().signal, progress: () => {}, afterCommit: () => {} });
    }
  } catch (e) {
    log.warn('pre-migration backup skipped', (e as Error).message);
  }
}
const mig = migrate(db, cfg.migrationsDir);
if (mig.applied.length) log.info(`migrated ${mig.from} → ${mig.to} (${mig.applied.join(', ')})`);

const startedAt = new Date().toISOString();
const sse = new Sse(db, logger('sse'));
const scheduler = new Scheduler(db, cfg, sse);
const api = createApi({ db, cfg, sse, scheduler, startedAt, lanUrls: () => lanUrls(cfg.port) });

let dev: DevMiddleware | null = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      const handled = await api.handle(req, res);
      if (!handled) sendError(res, 404, 'NOT_FOUND', `No route for ${req.method} ${p}`);
      return;
    }
    if (serveImage(req, res, p, cfg.imagesDir)) return;
    if (dev) {
      await dev.handle(req, res);
      return;
    }
    serveDist(req, res, p, cfg.distDir);
  } catch (e) {
    log.error(`unhandled ${req.method} ${req.url}`, (e as Error).stack);
    if (!res.headersSent) sendError(res, 500, 'INTERNAL', (e as Error).message);
    else res.end();
  }
});
server.keepAliveTimeout = 65_000;

if (cfg.dev) {
  dev = await createViteDev(server, ROOT_DIR, cfg.webDir);
  log.info('vite dev middleware mounted (HMR on)');
}

server.listen(cfg.port, cfg.host, () => {
  sse.start();
  scheduler.start();
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;
  cfg.port = port;
  const urls = lanUrls(port);
  console.log('');
  console.log(`  Riftbound Inventory v${cfg.version}${cfg.dev ? ' (dev)' : ''}`);
  console.log(`  Local:  http://localhost:${port}`);
  for (const u of urls) console.log(`  LAN:    ${u}`);
  console.log(`  Data:   ${cfg.dataDir}`);
  console.log('');
});

function shutdown(sig: string) {
  log.info(`${sig} received, shutting down`);
  scheduler.stop();
  sse.stop();
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
