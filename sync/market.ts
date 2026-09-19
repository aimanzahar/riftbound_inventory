import { all, one, run, nowIso, bumpCatalogVersion, type Db } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';

/** null is an explicitly rejected assignment; undefined means not yet reconciled. */
export function marketOverride(db: Db, cardId: string): number | null | undefined {
  return one<{ product_id: number | null }>(db, 'SELECT product_id FROM market_mappings WHERE card_id=?', cardId)?.product_id;
}

export function rejectedMarket(db: Db, cardId: string, productId: number): boolean {
  return !!one(db, 'SELECT 1 FROM market_rejections WHERE card_id=? AND product_id=?', cardId, productId);
}

export interface MarketDecision {
  cardId: string;
  productId: number | null;
  rejected: Array<{ productId: number; reason: string }>;
}

/** Publish corrected links and archive wrong prices atomically, even when no new price exists. */
export function applyMarketDecisions(db: Db, decisions: MarketDecision[]): boolean {
  let changed = false;
  db.tx(() => {
    const now = nowIso();
    for (const d of decisions) {
      for (const bad of d.rejected) {
        run(db, 'INSERT OR IGNORE INTO market_rejections VALUES (?,?,?,?)', d.cardId, bad.productId, bad.reason, now);
        const wrong = all(db, "SELECT * FROM prices WHERE card_id=? AND source IN ('tcgplayer','tcgplayer-dotgg') AND source_ref=?", d.cardId, String(bad.productId));
        if (wrong.length) {
          const history = all(db, 'SELECT * FROM price_history WHERE card_id=?', d.cardId);
          run(db, 'INSERT INTO price_corrections(card_id,rejected_product_id,prices_json,history_json,corrected_at) VALUES (?,?,?,?,?)', d.cardId, bad.productId, JSON.stringify(wrong), JSON.stringify(history), now);
          run(db, "DELETE FROM prices WHERE card_id=? AND source IN ('tcgplayer','tcgplayer-dotgg') AND source_ref=?", d.cardId, String(bad.productId));
          run(db, 'DELETE FROM price_history WHERE card_id=?', d.cardId);
          changed = true;
        }
      }
      const prev = one<{ tcgplayer_id: number | null }>(db, 'SELECT tcgplayer_id FROM cards WHERE id=?', d.cardId);
      run(db, 'INSERT INTO market_mappings VALUES (?,?,?) ON CONFLICT(card_id) DO UPDATE SET product_id=excluded.product_id,updated_at=excluded.updated_at', d.cardId, d.productId, now);
      if (prev && prev.tcgplayer_id !== d.productId) {
        run(db, 'UPDATE cards SET tcgplayer_id=?,updated_at=? WHERE id=?', d.productId, now, d.cardId);
        changed = true;
      }
    }
    if (changed) {
      insertChange(db, { kind: 'catalog', reason: 'cards', payload: { what: 'cards', catalog_version: bumpCatalogVersion(db) } });
      insertChange(db, { kind: 'prices', payload: { count: 0, fetched_at: now, source: 'tcgplayer' } });
    }
  });
  return changed;
}
