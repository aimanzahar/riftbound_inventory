import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Write to <file>.part then rename (atomic on the same volume). */
export function atomicWrite(file: string, data: Buffer | string): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readJsonFile<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJsonFile(file: string, value: unknown): void {
  atomicWrite(file, JSON.stringify(value, null, 2) + '\n');
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function listFiles(dir: string, re?: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !re || re.test(f))
    .sort();
}

export function removeStaleParts(dir: string): number {
  let n = 0;
  for (const f of listFiles(dir, /\.part$/)) {
    try {
      fs.unlinkSync(path.join(dir, f));
      n++;
    } catch {
      /* ignore */
    }
  }
  return n;
}
