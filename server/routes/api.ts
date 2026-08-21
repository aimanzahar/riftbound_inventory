import type { Db } from '../db/open.ts';
import { all, getSetting, nowIso, one, run, setSetting } from '../db/open.ts';
import type { Config } from '../config.ts';
import { Router } from '../http/router.ts';
import { HttpError, sendJson } from '../http/body.ts';
import type { Sse } from '../http/sse.ts';
import type { Scheduler } from '../scheduler.ts';
import { buildCatalog } from '../services/catalog.ts';
import { buildState, readSettings } from '../services/state.ts';
import { listChanges, maxSeq, resolveDevice, insertChange } from '../services/changes.ts';
import { applyInventory, normalizeCardId, undoChange, validateOpId } from '../services/inventory.ts';
import { buyProduct, previewPurchase } from '../services/purchase.ts';
import { exportCsv } from '../services/exportCsv.ts';
import { JobBusyError, isJobName, jobStatuses, recentRuns } from '../../sync/runner.ts';
import { PALETTE } from '../../shared/constants.ts';
import type { InventoryRequest, ServerInfo, SettingsPayload, TipPayload } from '../../shared/types.ts';
import fs from 'node:fs';
import path from 'node:path';

export interface ApiDeps {
  db: Db;
  cfg: Config;
  sse: Sse;
  scheduler: Scheduler;
  startedAt: string;
  lanUrls: () => string[];
}

function countImages(cfg: Config, db: Db): { mirrored: number; total: number } {
  const total = Number(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM cards WHERE active = 1 AND image_url IS NOT NULL')?.n ?? 0);
  let mirrored = 0;
  try {
    mirrored = fs.readdirSync(cfg.imagesDir).filter((f) => f.endsWith('.webp')).length;
  } catch {
    /* none yet */
  }
  return { mirrored, total };
}

function serverInfo(d: ApiDeps): ServerInfo {
  return { version: d.cfg.version, started_at: d.startedAt, lan_urls: d.lanUrls(), data_dir: d.cfg.dataDir, images: countImages(d.cfg, d.db) };
}

export function createApi(d: ApiDeps): Router {
  const { db, sse } = d;
  const r = new Router();

  r.get('/api/health', () => ({
    status: 200,
    body: { ok: true, version: d.cfg.version, seq: maxSeq(db), started_at: d.startedAt, lan_urls: d.lanUrls(), clients: sse.clientCount },
  }));

  r.get('/api/catalog', (ctx) => {
    const { json, catalog } = buildCatalog(db);
    const etag = `"${catalog.catalog_version}"`;
    if (ctx.req.headers['if-none-match'] === etag) {
      ctx.res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      ctx.res.end();
      return;
    }
    // stream pre-serialized buffer (gzip handled by sendJson path for objects; do it manually here)
    const body = JSON.parse(json.toString('utf8'));
    sendJson(ctx.res, 200, body, { req: ctx.req, headers: { ETag: etag, 'Cache-Control': 'no-cache' } });
  });

  r.get('/api/state', () => ({ status: 200, body: buildState(db, { jobs: jobStatuses(db), server: serverInfo(d) }) }));

  r.get('/api/changes', (ctx) => {
    const q = ctx.query;
    const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
    return {
      status: 200,
      body: {
        changes: listChanges(db, {
          limit: num('limit'),
          before: num('before'),
          after: num('after'),
          kind: q.get('kind') ?? undefined,
          reason: q.get('reason') ?? undefined,
          card_id: q.get('card_id') ?? undefined,
          entity: q.get('entity') ?? undefined,
        }),
      },
    };
  });

  r.post('/api/inventory', async (ctx) => {
    const body = await ctx.json<InventoryRequest>();
    if (!['manual', 'pack', 'csv', 'note'].includes(body.reason)) throw new HttpError(400, 'VALIDATION', 'reason must be manual|pack|csv|note');
    const device = resolveDevice(db, ctx.deviceId);
    const res = applyInventory(db, {
      op_id: body.op_id,
      reason: body.reason,
      mode: body.mode,
      items: body.items,
      device,
      csv_filename: typeof body.csv_filename === 'string' ? body.csv_filename.slice(0, 200) : undefined,
    });
    sse.drain();
    return { status: 200, body: res };
  });

  r.post('/api/changes/:seq/undo', async (ctx) => {
    const body = await ctx.json<{ op_id: string }>();
    const seq = Number(ctx.params.seq);
    if (!Number.isInteger(seq)) throw new HttpError(400, 'VALIDATION', 'bad seq');
    const res = undoChange(db, seq, body.op_id, resolveDevice(db, ctx.deviceId));
    sse.drain();
    return { status: 200, body: res };
  });

  r.get('/api/products/:id/preview', (ctx) => ({ status: 200, body: previewPurchase(db, ctx.params.id, Number(ctx.query.get('qty') ?? 1)) }));

  r.post('/api/products/:id/buy', async (ctx) => {
    const body = await ctx.json<{ op_id: string; qty?: number }>();
    const res = buyProduct(db, ctx.params.id, Number(body.qty ?? 1), body.op_id, resolveDevice(db, ctx.deviceId));
    sse.drain();
    return { status: 200, body: res };
  });

  r.get('/api/prices/:card_id/history', (ctx) => {
    const days = Math.min(Math.max(1, Number(ctx.query.get('days') ?? 90)), 730);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const history = all(db, `SELECT day, finish, usd_market, usd_low FROM price_history WHERE card_id = ? AND day >= ? ORDER BY day ASC`, ctx.params.card_id, since);
    return { status: 200, body: { history } };
  });

  r.put('/api/tips/:card_id', async (ctx) => {
    const body = await ctx.json<{ op_id: string; text: string }>();
    const op_id = validateOpId(body.op_id);
    const text = String(body.text ?? '').trim();
    if (text.length < 1 || text.length > 400) throw new HttpError(400, 'VALIDATION', 'tip must be 1-400 characters');
    if (text.split(/\s+/).length > 60) throw new HttpError(400, 'VALIDATION', 'tip must be 60 words or fewer');
    const cardId = normalizeCardId(ctx.params.card_id);
    if (!one(db, 'SELECT 1 FROM cards WHERE id = ?', cardId)) throw new HttpError(404, 'NOT_FOUND', 'card not found');
    const device = resolveDevice(db, ctx.deviceId);
    const result = db.tx(() => {
      const prev = one<{ text: string }>(db, 'SELECT text FROM tips WHERE card_id = ?', cardId);
      run(
        db,
        `INSERT INTO tips(card_id, text, source, edited_at, edited_by) VALUES (?,?,'user',?,?)
         ON CONFLICT(card_id) DO UPDATE SET text=excluded.text, source='user', edited_at=excluded.edited_at, edited_by=excluded.edited_by`,
        cardId,
        text,
        nowIso(),
        device?.id ?? null,
      );
      const payload: TipPayload = { card_id: cardId, text, prev_text: prev?.text ?? null };
      const change = insertChange(db, { op_id, device, kind: 'tip', entity: cardId, payload });
      const tip = one(db, 'SELECT card_id, text, source, model, generated_at, edited_at, edited_by FROM tips WHERE card_id = ?', cardId);
      return { tip, change };
    });
    sse.drain();
    return { status: 200, body: result };
  });

  r.put('/api/devices/:id', async (ctx) => {
    const body = await ctx.json<{ name: string; color: string }>();
    const id = ctx.params.id;
    if (ctx.deviceId && ctx.deviceId !== id) throw new HttpError(403, 'FORBIDDEN', 'id must match X-Device-Id');
    const name = String(body.name ?? '').trim().slice(0, 32) || 'Guest';
    const color = typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : PALETTE[0];
    run(
      db,
      `INSERT INTO devices(id, name, color, created_at, last_seen_at) VALUES (?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, last_seen_at=excluded.last_seen_at`,
      id,
      name,
      color,
      nowIso(),
      nowIso(),
    );
    sse.presence();
    return { status: 200, body: { device: one(db, 'SELECT id, name, color, last_seen_at FROM devices WHERE id = ?', id) } };
  });

  r.put('/api/settings', async (ctx) => {
    const body = await ctx.json<Partial<SettingsPayload> & { op_id?: string }>();
    const device = resolveDevice(db, ctx.deviceId);
    const settings = db.tx(() => {
      if (body.playset_size !== undefined) setSetting(db, 'playset_size', clampInt(body.playset_size, 1, 99, 3));
      if (body.rune_playset_size !== undefined) setSetting(db, 'rune_playset_size', clampInt(body.rune_playset_size, 1, 99, 12));
      if (body.fx_manual_rate !== undefined) setSetting(db, 'fx_manual_rate', body.fx_manual_rate === null ? null : Number(body.fx_manual_rate) > 0 ? Number(body.fx_manual_rate) : null);
      if (body.collection_name !== undefined) setSetting(db, 'collection_name', String(body.collection_name).trim().slice(0, 60) || 'Riftbound Inventory');
      const s = readSettings(db);
      insertChange(db, { op_id: body.op_id ?? null, device, kind: 'settings', payload: s });
      return s;
    });
    sse.drain();
    return { status: 200, body: { settings } };
  });

  r.get('/api/jobs', () => {
    const backups = fs.existsSync(d.cfg.backupsDir)
      ? fs
          .readdirSync(d.cfg.backupsDir)
          .filter((f) => f.endsWith('.db'))
          .map((f) => {
            const st = fs.statSync(path.join(d.cfg.backupsDir, f));
            return { file: f, size_bytes: st.size, created_at: st.mtime.toISOString() };
          })
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
      : [];
    return { status: 200, body: { jobs: jobStatuses(db), backups, images: countImages(d.cfg, db) } };
  });

  r.get('/api/jobs/:name/runs', (ctx) => {
    if (!isJobName(ctx.params.name)) throw new HttpError(404, 'NOT_FOUND', 'unknown job');
    return { status: 200, body: { runs: recentRuns(db, ctx.params.name) } };
  });

  r.post('/api/jobs/:name/run', async (ctx) => {
    const name = ctx.params.name;
    if (!isJobName(name)) throw new HttpError(404, 'NOT_FOUND', 'unknown job');
    const body = await ctx.json<{ force?: boolean }>().catch(() => ({}) as { force?: boolean });
    try {
      d.scheduler.runNow(name, Boolean(body.force));
    } catch (e) {
      if (e instanceof JobBusyError) throw new HttpError(409, 'JOB_RUNNING', e.message);
      throw e;
    }
    return { status: 202, body: { queued: true, job: name } };
  });

  r.get('/api/export.csv', (ctx) => {
    const csv = exportCsv(db, ctx.query.get('include_zero') === '1');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
    ctx.res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="riftbound-inventory-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    });
    ctx.res.end(csv);
  });

  r.get('/api/events', (ctx) => {
    const deviceId = ctx.query.get('device_id');
    const name = ctx.query.get('name');
    const color = ctx.query.get('color');
    if (deviceId) {
      const existing = one<{ id: string }>(db, 'SELECT id FROM devices WHERE id = ?', deviceId);
      if (existing) {
        if (name) run(db, 'UPDATE devices SET name = ?, color = COALESCE(?, color), last_seen_at = ? WHERE id = ?', name.slice(0, 32), color && /^#[0-9a-f]{6}$/i.test(color) ? color : null, nowIso(), deviceId);
        else run(db, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', nowIso(), deviceId);
      } else {
        run(
          db,
          'INSERT INTO devices(id, name, color, created_at, last_seen_at) VALUES (?,?,?,?,?)',
          deviceId,
          (name ?? 'Guest').slice(0, 32) || 'Guest',
          color && /^#[0-9a-f]{6}$/i.test(color) ? color : PALETTE[Math.floor(Math.random() * PALETTE.length)],
          nowIso(),
          nowIso(),
        );
      }
    }
    sse.handle(ctx.req, ctx.res, deviceId);
  });

  return r;
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export { getSetting };
