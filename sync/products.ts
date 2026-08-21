// Job: products — seed/products.json → products + product_contents (replace per product), catalog change row.
import fs from 'node:fs';
import path from 'node:path';
import type { JobCtx, JobResult } from './types.ts';
import { readJsonFile } from './lib/files.ts';
import { all, bumpCatalogVersion, nowIso, run as sqlRun } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';
import type { CatalogPayload, ProductKind } from '../shared/types.ts';

const KINDS: readonly ProductKind[] = ['starter_set', 'champion_deck', 'showdown_deck', 'prerift_kit', 'booster_pack', 'booster_box', 'bundle', 'other'];

interface SeedContent {
  card_id: string;
  finish?: string;
  qty: number;
}
interface SeedProduct {
  id: string;
  name: string;
  set_code?: string | null;
  kind: string;
  release_date?: string | null;
  msrp_usd?: number | null;
  tcgplayer_id?: number | null;
  image_url?: string | null;
  source_url?: string | null;
  fixed_contents?: number | boolean | null;
  notes?: string | null;
  contents?: SeedContent[];
}

interface ProductRowDb {
  id: string;
  name: string;
  set_code: string | null;
  kind: string;
  release_date: string | null;
  msrp_usd: number | null;
  tcgplayer_id: number | null;
  image_url: string | null;
  source_url: string | null;
  fixed_contents: number;
  notes: string | null;
  active: number;
}

export function resolveSeedFile(ctx: Pick<JobCtx, 'cfg' | 'flags'>): string {
  const f = ctx.flags.file;
  if (typeof f === 'string' && f.trim()) return path.resolve(f);
  return path.join(ctx.cfg.seedDir, 'products.json');
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, log } = ctx;
  const file = resolveSeedFile(ctx);
  if (!fs.existsSync(file)) {
    const message = `seed missing: ${file} (run npm run seed:products first)`;
    log.warn(message);
    return { ok: 0, failed: 0, message, changed: false };
  }
  const doc = readJsonFile<unknown>(file);
  const list: SeedProduct[] = Array.isArray(doc) ? (doc as SeedProduct[]) : Array.isArray((doc as { products?: unknown[] }).products) ? ((doc as { products: SeedProduct[] }).products) : [];
  if (!list.length) return { ok: 0, failed: 0, message: `seed empty: ${file}`, changed: false };

  const stats = { added: 0, updated: 0, unchanged: 0, skipped: 0, contents: 0 };
  const skipped: string[] = [];
  const now = nowIso();

  db.tx(() => {
    const setCodes = new Set(all<{ code: string }>(db, 'SELECT code FROM sets').map((s) => s.code));
    const cardIds = new Set(all<{ id: string }>(db, 'SELECT id FROM cards').map((c) => c.id));
    const existing = new Map(
      all<ProductRowDb>(db, 'SELECT id, name, set_code, kind, release_date, msrp_usd, tcgplayer_id, image_url, source_url, fixed_contents, notes, active FROM products').map((p) => [p.id, p]),
    );
    const existingContents = new Map<string, string>();
    for (const row of all<{ product_id: string; card_id: string; finish: string; qty: number }>(db, 'SELECT product_id, card_id, finish, qty FROM product_contents ORDER BY product_id, card_id, finish')) {
      const key = row.product_id;
      existingContents.set(key, (existingContents.get(key) ?? '') + `${row.card_id}:${row.finish}:${Number(row.qty)};`);
    }

    const upProduct = db.raw.prepare(
      `INSERT INTO products(id, name, set_code, kind, release_date, msrp_usd, tcgplayer_id, image_url, source_url, fixed_contents, notes, active, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, set_code=excluded.set_code, kind=excluded.kind, release_date=excluded.release_date,
         msrp_usd=excluded.msrp_usd, tcgplayer_id=excluded.tcgplayer_id, image_url=excluded.image_url, source_url=excluded.source_url,
         fixed_contents=excluded.fixed_contents, notes=excluded.notes, active=1, updated_at=excluded.updated_at`,
    );
    const delContents = db.raw.prepare('DELETE FROM product_contents WHERE product_id = ?');
    const insContent = db.raw.prepare('INSERT INTO product_contents(product_id, card_id, finish, qty) VALUES (?,?,?,?)');

    for (const p of list) {
      const id = str(p?.id);
      const name = str(p?.name);
      if (!id || !name) {
        stats.skipped++;
        skipped.push(`${id ?? '?'} (missing id/name)`);
        continue;
      }
      const kind = str(p.kind) ?? 'other';
      if (!(KINDS as readonly string[]).includes(kind)) {
        stats.skipped++;
        skipped.push(`${id} (bad kind ${kind})`);
        continue;
      }
      // contents: merge duplicates (card, finish), validate ids
      const merged = new Map<string, { card_id: string; finish: string; qty: number }>();
      const unknown: string[] = [];
      for (const c of Array.isArray(p.contents) ? p.contents : []) {
        const cardId = str(c?.card_id)?.toUpperCase();
        const qty = Math.floor(Number(c?.qty));
        if (!cardId || !Number.isFinite(qty) || qty <= 0) continue;
        const finish = c.finish === 'foil' ? 'foil' : 'normal';
        if (!cardIds.has(cardId)) {
          if (!unknown.includes(cardId)) unknown.push(cardId);
          continue;
        }
        const key = `${cardId}:${finish}`;
        const prev = merged.get(key);
        if (prev) prev.qty += qty;
        else merged.set(key, { card_id: cardId, finish, qty });
      }
      if (unknown.length) {
        stats.skipped++;
        skipped.push(`${id} (unknown cards: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ', …' : ''})`);
        continue;
      }
      let setCode = str(p.set_code)?.toUpperCase() ?? null;
      if (setCode && !setCodes.has(setCode)) {
        log.warn(`product ${id}: unknown set ${setCode} → stored without set`);
        setCode = null;
      }
      const fixed = p.fixed_contents === undefined || p.fixed_contents === null ? (merged.size > 0 ? 1 : 0) : Number(p.fixed_contents) ? 1 : 0;
      const next = {
        name,
        set_code: setCode,
        kind,
        release_date: str(p.release_date),
        msrp_usd: num(p.msrp_usd),
        tcgplayer_id: num(p.tcgplayer_id),
        image_url: str(p.image_url),
        source_url: str(p.source_url),
        fixed_contents: fixed,
        notes: str(p.notes),
        active: 1,
      };
      const prev = existing.get(id);
      const prevCmp = prev
        ? {
            name: prev.name,
            set_code: prev.set_code,
            kind: prev.kind,
            release_date: prev.release_date,
            msrp_usd: prev.msrp_usd === null ? null : Number(prev.msrp_usd),
            tcgplayer_id: prev.tcgplayer_id === null ? null : Number(prev.tcgplayer_id),
            image_url: prev.image_url,
            source_url: prev.source_url,
            fixed_contents: Number(prev.fixed_contents),
            notes: prev.notes,
            active: Number(prev.active),
          }
        : null;
      const contentsKey = [...merged.values()]
        .sort((a, b) => a.card_id.localeCompare(b.card_id) || a.finish.localeCompare(b.finish))
        .map((c) => `${c.card_id}:${c.finish}:${c.qty};`)
        .join('');
      const productChanged = !prevCmp || JSON.stringify(prevCmp) !== JSON.stringify(next);
      const contentsChanged = (existingContents.get(id) ?? '') !== contentsKey;
      if (productChanged) {
        upProduct.run(id, next.name, next.set_code, next.kind, next.release_date, next.msrp_usd, next.tcgplayer_id, next.image_url, next.source_url, next.fixed_contents, next.notes, now);
      }
      if (contentsChanged) {
        delContents.run(id);
        for (const c of merged.values()) insContent.run(id, c.card_id, c.finish, c.qty);
      }
      if (productChanged || contentsChanged) {
        if (prev) stats.updated++;
        else stats.added++;
      } else stats.unchanged++;
      stats.contents += merged.size;
    }

    if (stats.added + stats.updated > 0) {
      const version = bumpCatalogVersion(db);
      const payload: CatalogPayload = { what: 'products', catalog_version: version, stats: { added: stats.added, updated: stats.updated, skipped: stats.skipped, unchanged: stats.unchanged } };
      insertChange(db, { kind: 'catalog', reason: 'products', payload });
    }
  });

  const changed = stats.added + stats.updated > 0;
  const message = [
    `${list.length} products in ${path.basename(file)}`,
    `added ${stats.added}, updated ${stats.updated}, unchanged ${stats.unchanged}`,
    stats.skipped ? `skipped ${stats.skipped}: ${skipped.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  log.info(message);
  return { ok: stats.added + stats.updated + stats.unchanged, failed: stats.skipped, message, changed };
}
