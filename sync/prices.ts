// Job: prices — TCGplayer USD via tcgcsv (default) | dotgg | localjson → prices + price_history, one 'prices' change row.
import type { JobCtx, JobResult } from './types.ts';
import type { PriceRow } from './sources/types.ts';
import { fetchTcgcsvPrices } from './sources/prices.tcgcsv.ts';
import { DOTGG_PRICE_SOURCE, fetchDotggPrices } from './sources/prices.dotgg.ts';
import { loadLocalPrices } from './sources/prices.localjson.ts';
import { all, nowIso, today } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';
import type { PricesPayload } from '../shared/types.ts';

/** Upsert rows (prices + price_history for `day`) in ONE transaction. Unknown card ids are skipped. Returns written/skipped counts. */
export function writePriceRows(ctx: Pick<JobCtx, 'db'>, rows: PriceRow[], fetchedAt: string, day = today()): { written: number; skipped: number; cards: Set<string> } {
  const { db } = ctx;
  const cards = new Set<string>();
  let written = 0;
  let skipped = 0;
  if (!rows.length) return { written, skipped, cards };
  db.tx(() => {
    const known = new Set(all<{ id: string }>(db, 'SELECT id FROM cards').map((c) => c.id));
    const upPrice = db.raw.prepare(
      `INSERT INTO prices(card_id, finish, usd_market, usd_low, usd_mid, usd_high, source, source_ref, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(card_id, finish) DO UPDATE SET usd_market=excluded.usd_market, usd_low=excluded.usd_low, usd_mid=excluded.usd_mid,
         usd_high=excluded.usd_high, source=excluded.source, source_ref=excluded.source_ref, fetched_at=excluded.fetched_at`,
    );
    const upHist = db.raw.prepare(
      `INSERT INTO price_history(card_id, finish, day, usd_market, usd_low) VALUES (?,?,?,?,?)
       ON CONFLICT(card_id, finish, day) DO UPDATE SET usd_market=excluded.usd_market, usd_low=excluded.usd_low`,
    );
    for (const r of rows) {
      if (!known.has(r.card_id)) {
        skipped++;
        continue;
      }
      const market = r.usd_market !== null && r.usd_market < 0 ? null : r.usd_market;
      upPrice.run(r.card_id, r.finish, market, r.usd_low, r.usd_mid, r.usd_high, r.source, r.source_ref, fetchedAt);
      upHist.run(r.card_id, r.finish, day, market, r.usd_low);
      cards.add(r.card_id);
      written++;
    }
  });
  return { written, skipped, cards };
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, cfg, log } = ctx;
  const sourceName = typeof ctx.flags.source === 'string' ? ctx.flags.source : cfg.priceSource || 'tcgcsv';
  const fetchedAt = nowIso();
  const day = today();
  const cardsPriced = new Set<string>();
  let count = 0;
  let failed = 0;
  let mappingChanged = false;
  let sourceLabel = '';
  const notes: string[] = [];

  const ingest = (rows: PriceRow[]) => {
    const r = writePriceRows(ctx, rows, fetchedAt, day);
    count += r.written;
    for (const id of r.cards) cardsPriced.add(id);
    return r;
  };

  const runDotgg = async () => {
    const { rows, known } = await fetchDotggPrices(ctx);
    const r = ingest(rows);
    sourceLabel = DOTGG_PRICE_SOURCE;
    notes.push(`dotgg: ${r.written} prices for ${r.cards.size}/${known} cards`);
  };

  if (sourceName === 'tcgcsv') {
    sourceLabel = 'tcgplayer';
    const unmatched: string[] = [];
    let unmatchedCount = 0;
    let groupsOk = 0;
    let sealed = 0;
    let ambiguous = 0;
    try {
      const res = await fetchTcgcsvPrices(ctx, (g) => {
        if (g.error) { notes.push(`${g.group.name}: ${g.error}`); return; }
        ambiguous += g.ambiguous;
        const r = ingest(g.rows);
        groupsOk++;
        sealed += g.sealed;
        unmatchedCount += g.unmatched.length;
        for (const u of g.unmatched.slice(0, 3)) if (unmatched.length < 12) unmatched.push(`${g.set?.code ?? g.group.abbreviation ?? g.group.name} ${u.number} ${u.name} (#${u.productId})`);
        log.info(`tcgcsv ${g.group.abbreviation ?? g.group.name}: ${r.written} prices, ${g.matchedProducts} products matched, ${g.unmatched.length} unmatched, ${g.sealed} sealed`);
      });
      failed = res.failedGroups;
      mappingChanged = res.changed;
      notes.push(`resolved ${res.resolved} listings, rejected ${res.rejected} incorrect assignments`);
      notes.push(`tcgcsv: ${count} prices for ${cardsPriced.size} cards across ${groupsOk}/${res.groups} groups, ambiguous ${ambiguous}, unmatched ${unmatchedCount} numbered products, ${sealed} sealed skipped${unmatched.length ? ` · e.g. ${unmatched.join('; ')}` : ''}`);
    } catch (e) {
      const msg = `tcgcsv failed: ${(e as Error).message}`;
      log.warn(msg);
      notes.push(msg);
      if (count === 0) {
        try {
          await runDotgg();
          failed = 1; // primary failed → partial
        } catch (e2) {
          notes.push(`dotgg fallback failed: ${(e2 as Error).message}`);
          failed++;
        }
      }
    }
  } else if (sourceName === 'dotgg') {
    await runDotgg();
  } else if (sourceName === 'localjson') {
    const rows = await loadLocalPrices(ctx);
    const r = ingest(rows);
    sourceLabel = rows[0]?.source ?? 'localjson';
    notes.push(`localjson: ${r.written} prices for ${r.cards.size} cards, ${r.skipped} unknown ids skipped`);
  } else {
    throw new Error(`unknown price source "${sourceName}" (expected tcgcsv|dotgg|localjson)`);
  }

  const active = all<{ id: string }>(db, 'SELECT id FROM cards WHERE active=1');
  notes.push(`${active.length - cardsPriced.size}/${active.length} active cards without a fresh price`);

  if (count === 0) {
    const message = `error: no prices matched (${notes.join(' · ')})`;
    log.error(message);
    return { ok: 0, failed: Math.max(1, failed), message, changed: mappingChanged };
  }

  db.tx(() => {
    const payload: PricesPayload = { count, fetched_at: fetchedAt, source: sourceLabel };
    insertChange(db, { kind: 'prices', payload });
  });
  const message = notes.join(' · ');
  log.info(message);
  return { ok: count, failed, message, changed: true };
}
