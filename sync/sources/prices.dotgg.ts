// DotGG price fallback — `price` / `foilPrice` (TCGplayer market, USD) from the same getcards payload the cards job uses.
import type { JobCtx } from '../types.ts';
import type { PriceRow } from './types.ts';
import { fetchDotggCards, indexJoinRows } from './cards.dotgg.ts';
import { marketOverride, rejectedMarket } from '../market.ts';
import { all } from '../../server/db/open.ts';

export const DOTGG_PRICE_SOURCE = 'tcgplayer-dotgg';

export async function fetchDotggPrices(ctx: JobCtx): Promise<{ rows: PriceRow[]; known: number }> {
  const rows = indexJoinRows(await fetchDotggCards(ctx));
  const ours = new Map(all<{ id: string; variant_kind: string | null }>(ctx.db, 'SELECT id, variant_kind FROM cards WHERE active = 1').map((c) => [c.id, c.variant_kind]));
  const out: PriceRow[] = [];
  let known = 0;
  for (const r of rows.values()) {
    if (!ours.has(r.id)) continue;
    known++;
    const verified = marketOverride(ctx.db, r.id);
    if (verified !== undefined && (verified === null || verified !== r.tcgplayer_id)) continue;
    if (r.tcgplayer_id !== null && rejectedMarket(ctx.db, r.id, r.tcgplayer_id)) continue;
    // A fallback has no product metadata with which to validate a promo assignment.
    if (verified === undefined && (ours.get(r.id) === 'promo' || /-P(?:\d|$|-)/.test(r.id))) continue;
    const ref = r.tcgplayer_id === null ? null : String(r.tcgplayer_id);
    if (r.price !== null && r.has_normal !== false) out.push({ card_id: r.id, finish: 'normal', usd_market: r.price, usd_low: null, usd_mid: null, usd_high: null, source: DOTGG_PRICE_SOURCE, source_ref: ref });
    if (r.foil_price !== null && r.has_foil !== false) out.push({ card_id: r.id, finish: 'foil', usd_market: r.foil_price, usd_low: null, usd_mid: null, usd_high: null, source: DOTGG_PRICE_SOURCE, source_ref: ref });
  }
  ctx.log.info(`dotgg prices: ${out.length} rows for ${known} known cards`);
  return { rows: out, known };
}
