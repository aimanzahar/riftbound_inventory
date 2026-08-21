import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './open.ts';

/** Apply NNN_*.sql files with NNN > PRAGMA user_version, each in its own tx. Returns applied count. */
export function migrate(db: Db, migrationsDir: string): { applied: string[]; from: number; to: number } {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort();
  const current = Number((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const applied: string[] = [];
  let version = current;
  for (const f of files) {
    const n = Number(f.slice(0, 3));
    if (n <= current) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    db.tx(() => {
      db.raw.exec(sql);
      db.raw.exec(`PRAGMA user_version = ${n}`);
    });
    version = n;
    applied.push(f);
  }
  return { applied, from: current, to: version };
}

export function pendingMigrations(db: Db, migrationsDir: string): number {
  const current = Number((db.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  return fs.readdirSync(migrationsDir).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > current).length;
}
