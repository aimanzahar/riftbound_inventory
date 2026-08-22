import type { Db } from '../db/open.ts';
import { all, getSetting, one } from '../db/open.ts';
import type { Device, Fx, InventoryRow, JobStatus, Price, ServerInfo, Settings, State, Tip } from '../../shared/types.ts';
import { listPurchases, maxSeq } from './changes.ts';
import { listUserDecks } from './decks.ts';

export function readSettings(db: Db): Settings {
  return {
    playset_size: getSetting<number>(db, 'playset_size', 3),
    rune_playset_size: getSetting<number>(db, 'rune_playset_size', 12),
    fx_manual_rate: getSetting<number | null>(db, 'fx_manual_rate', null),
    collection_name: getSetting<string>(db, 'collection_name', 'Riftbound Inventory'),
  };
}

export function currentFx(db: Db): Fx | null {
  const r = one<{ base: 'USD'; quote: 'MYR'; day: string; rate: number; source: string; fetched_at: string }>(
    db,
    `SELECT base, quote, day, rate, source, fetched_at FROM fx_rates WHERE base='USD' AND quote='MYR' ORDER BY day DESC LIMIT 1`,
  );
  if (!r) {
    const manual = getSetting<number | null>(db, 'fx_manual_rate', null);
    if (manual && manual > 0) {
      const day = new Date().toISOString().slice(0, 10);
      return { base: 'USD', quote: 'MYR', rate: manual, day, source: 'manual', fetched_at: new Date().toISOString(), stale: true };
    }
    return null;
  }
  const ageDays = (Date.now() - Date.parse(r.day + 'T00:00:00Z')) / 86400000;
  return { ...r, rate: Number(r.rate), stale: ageDays > 2 || r.source === 'manual' };
}

export function buildState(db: Db, extras: { jobs: JobStatus[]; server: ServerInfo }): State {
  return db.read(() => {
    const seq = maxSeq(db);
    const catalog_version = getSetting<number>(db, 'catalog_version', 1);
    const inventory = all<InventoryRow>(db, `SELECT card_id, finish, qty, note, updated_at, updated_by FROM inventory WHERE qty > 0 OR note <> ''`).map((r) => ({ ...r, qty: Number(r.qty) }));
    const prices = all<Price>(db, 'SELECT card_id, finish, usd_market, usd_low, usd_mid, usd_high, source, fetched_at FROM prices').map((p) => ({
      ...p,
      usd_market: p.usd_market === null ? null : Number(p.usd_market),
      usd_low: p.usd_low === null ? null : Number(p.usd_low),
      usd_mid: p.usd_mid === null ? null : Number(p.usd_mid),
      usd_high: p.usd_high === null ? null : Number(p.usd_high),
    }));
    const tips = all<Tip>(db, 'SELECT card_id, text, source, model, generated_at, edited_at, edited_by FROM tips');
    const devices = all<Device>(db, 'SELECT id, name, color, last_seen_at FROM devices ORDER BY last_seen_at DESC');
    return {
      seq,
      catalog_version,
      inventory,
      prices,
      fx: currentFx(db),
      tips,
      devices,
      purchases: listPurchases(db, 100),
      user_decks: listUserDecks(db),
      settings: readSettings(db),
      jobs: extras.jobs,
      server: extras.server,
    };
  });
}
