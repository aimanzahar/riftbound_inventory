import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..');

// Load ./.env if present (instead of --env-file, which trips node --watch when the file is missing).
try {
  (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(path.join(ROOT_DIR, '.env'));
} catch {
  /* no .env — fine */
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export interface Config {
  port: number;
  host: string;
  dev: boolean;
  dataDir: string;
  dbPath: string;
  imagesDir: string;
  thumbsDir: string;
  backupsDir: string;
  tipsDir: string;
  seedDir: string;
  distDir: string;
  webDir: string;
  migrationsDir: string;
  noScheduler: boolean;
  version: string;
  codexModel: string | null;
  cardSource: string;
  priceSource: string;
  metaSource: string;
}

export function loadConfig(argv: string[] = process.argv.slice(2), env = process.env): Config {
  const dataDir = path.resolve(ROOT_DIR, env.DATA_DIR || './data');
  return {
    port: env.PORT !== undefined && env.PORT !== '' && Number.isFinite(Number(env.PORT)) ? Number(env.PORT) : 8787,
    host: env.HOST || '0.0.0.0',
    dev: argv.includes('--dev'),
    dataDir,
    dbPath: path.join(dataDir, 'app.db'),
    imagesDir: path.join(dataDir, 'images'),
    thumbsDir: path.join(dataDir, 'images', 'thumb'),
    backupsDir: path.join(dataDir, 'backups'),
    tipsDir: path.join(dataDir, 'tips'),
    seedDir: path.join(ROOT_DIR, 'seed'),
    distDir: path.join(ROOT_DIR, 'dist'),
    webDir: path.join(ROOT_DIR, 'web'),
    migrationsDir: path.join(here, 'db', 'migrations'),
    noScheduler: env.NO_SCHEDULER === '1' || env.NO_SCHEDULER === 'true',
    version: readVersion(),
    codexModel: env.CODEX_MODEL || null,
    cardSource: env.CARD_SOURCE || 'riot',
    priceSource: env.PRICE_SOURCE || 'tcgcsv',
    metaSource: env.META_SOURCE || 'riftools',
  };
}

export function ensureDataDirs(cfg: Config): void {
  for (const d of [cfg.dataDir, cfg.imagesDir, cfg.thumbsDir, cfg.backupsDir, cfg.tipsDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
