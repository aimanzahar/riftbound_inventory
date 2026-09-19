// Job: images — mirror card art locally as webp: data/images/<id>.webp (full) + data/images/thumb/<id>.webp.
// Primary: Riot/Sanity CDN with `fm=webp&w=…` params (verified: image/webp). Fallback: dotgg static webp (full only; thumb = same file).
import fs from 'node:fs';
import path from 'node:path';
import type { JobCtx, JobResult } from './types.ts';
import { fetchBuffer, pooled } from './lib/http.ts';
import { atomicWrite, ensureDir, removeStaleParts } from './lib/files.ts';
import { all } from '../server/db/open.ts';

const MIN_BYTES = 2048;
const CONCURRENCY = 4;
const SPACING_MS = 150;

interface CardImg {
  id: string;
  image_url: string;
  orientation: string;
}

/** Sanity image params: portrait → width, landscape → height (keeps the short side at the requested size). */
export function riotVariantUrl(imageUrl: string, orientation: string, kind: 'full' | 'thumb'): string {
  const host = new URL(imageUrl).hostname;
  if (host !== 'cmsassets.rgpub.io' && host !== 'cdn.sanity.io') return imageUrl;
  const sep = imageUrl.includes('?') ? '&' : '?';
  const size = kind === 'full' ? 744 : 300;
  const q = kind === 'full' ? 80 : 75;
  const dim = orientation === 'landscape' ? `h=${size}` : `w=${size}`;
  return `${imageUrl}${sep}fm=webp&${dim}&q=${q}`;
}

/** dotgg ids: our 's' suffix is '-STAR' there ('OGN-303s' → 'OGN-303-STAR'). */
export function dotggImageUrl(id: string): string {
  const dotggId = id.replace(/s$/, '-STAR');
  return `https://static.dotgg.gg/riftbound/cards/${dotggId}.webp`;
}

async function download(url: string, signal: AbortSignal): Promise<Buffer> {
  const { buf, contentType, status } = await fetchBuffer(url, { signal, timeoutMs: 30000, retries: 1 });
  if (status >= 400) throw new Error(`HTTP ${status}`);
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`not an image (${contentType || 'no content-type'})`);
  if (buf.length < MIN_BYTES) throw new Error(`too small (${buf.length} B)`);
  return buf;
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, cfg, log } = ctx;
  ensureDir(cfg.imagesDir);
  ensureDir(cfg.thumbsDir);
  removeStaleParts(cfg.imagesDir);
  removeStaleParts(cfg.thumbsDir);

  const cards = all<CardImg>(
    db,
    `SELECT c.id, c.image_url, c.orientation FROM cards c JOIN sets s ON s.code = c.set_code
     WHERE c.active = 1 AND c.image_url IS NOT NULL ORDER BY s.sort_order, c.set_code, c.number_int, c.number`,
  );
  const fullPath = (id: string) => path.join(cfg.imagesDir, `${id}.webp`);
  const thumbPath = (id: string) => path.join(cfg.thumbsDir, `${id}.webp`);
  // `--force` only overrides the runner lock; `--redownload` re-fetches files that already exist
  const force = Boolean(ctx.flags.redownload);
  let todo = cards.filter((c) => force || !fs.existsSync(fullPath(c.id)) || !fs.existsSync(thumbPath(c.id)));
  const missingTotal = todo.length;
  const limit = Number(ctx.flags.limit);
  if (Number.isFinite(limit) && limit > 0) todo = todo.slice(0, limit);
  if (!todo.length) {
    const message = `all ${cards.length} images present`;
    log.info(message);
    return { ok: 0, failed: 0, message, changed: false };
  }
  log.info(`downloading ${todo.length} of ${missingTotal} missing (${cards.length} cards total)`);

  let ok = 0;
  let failed = 0;
  let fallbacks = 0;
  let done = 0;
  let skippedAbort = 0;
  const failures: string[] = [];

  await pooled(todo, CONCURRENCY, SPACING_MS, async (card) => {
    if (ctx.signal.aborted) {
      skippedAbort++;
      return;
    }
    const needFull = force || !fs.existsSync(fullPath(card.id));
    const needThumb = force || !fs.existsSync(thumbPath(card.id));
    try {
      let full: Buffer | null = null;
      let thumb: Buffer | null = null;
      try {
        if (needFull) full = await download(riotVariantUrl(card.image_url, card.orientation, 'full'), ctx.signal);
        if (needThumb) thumb = await download(riotVariantUrl(card.image_url, card.orientation, 'thumb'), ctx.signal);
      } catch (e) {
        if (ctx.signal.aborted) throw e;
        // fallback: dotgg webp (no resize params) — full + thumb share the same bytes
        const buf = await download(dotggImageUrl(card.id), ctx.signal).catch((e2) => {
          throw new Error(`riot: ${(e as Error).message}; dotgg: ${(e2 as Error).message}`);
        });
        fallbacks++;
        if (needFull) full = buf;
        if (needThumb) thumb = buf;
      }
      if (full) atomicWrite(fullPath(card.id), full);
      if (thumb) atomicWrite(thumbPath(card.id), thumb);
      ok++;
    } catch (e) {
      failed++;
      if (failures.length < 8) failures.push(`${card.id}: ${(e as Error).message}`);
      log.warn(`${card.id}: ${(e as Error).message}`);
    } finally {
      done++;
      if (done % 25 === 0 || done === todo.length) ctx.progress(done, todo.length, `images ${done}/${todo.length}`);
    }
  });

  const remaining = Math.max(0, missingTotal - ok);
  const message = [
    `downloaded ${ok}/${todo.length}`,
    fallbacks ? `${fallbacks} via dotgg fallback` : '',
    failed ? `failed ${failed}` : '',
    skippedAbort ? `aborted ${skippedAbort}` : '',
    `remaining ${remaining} of ${cards.length}`,
    failures.length ? `errors: ${failures.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  log.info(message);
  return { ok, failed, message, changed: false };
}
