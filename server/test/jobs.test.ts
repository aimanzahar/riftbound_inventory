// Offline tests for the sync jobs using the localjson sources + fixtures (temp DATA_DIR, no network).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDataDirs, loadConfig, type Config } from '../config.ts';
import { openDb, all, one, getSetting, type Db } from '../db/open.ts';
import { migrate } from '../db/migrate.ts';
import type { JobCtx, JobFlags } from '../../sync/types.ts';
import { run as runCards, computeVariants, normalizeName } from '../../sync/cards.ts';
import { run as runProducts } from '../../sync/products.ts';
import { run as runPrices } from '../../sync/prices.ts';
import { run as runFx } from '../../sync/fx.ts';
import { run as runMeta, codeToId, deckId } from '../../sync/meta.ts';
import { htmlToText, replaceGlyphTokens } from '../../sync/sources/cards.riot.ts';
import { parseTcgNumber, matchGroupsToSets } from '../../sync/sources/prices.tcgcsv.ts';
import { riotVariantUrl, dotggImageUrl } from '../../sync/images.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const fixture = (name: string) => path.join(fixtures, name);

let tmp: string;
let cfg: Config;
let db: Db;

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function ctx(flags: JobFlags = {}): JobCtx {
  return {
    db,
    cfg,
    log: silent as unknown as JobCtx['log'],
    flags,
    trigger: 'cli',
    signal: new AbortController().signal,
    progress() {},
    afterCommit() {},
  };
}

function count(table: string, where = '1=1'): number {
  return Number(one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)?.n ?? 0);
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-jobs-'));
  cfg = loadConfig([], { ...process.env, DATA_DIR: tmp, CARD_SOURCE: 'localjson', PRICE_SOURCE: 'localjson', META_SOURCE: 'localjson', NO_SCHEDULER: '1' } as NodeJS.ProcessEnv);
  ensureDataDirs(cfg);
  db = openDb(cfg.dbPath);
  migrate(db, cfg.migrationsDir);
});

after(() => {
  db.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore on Windows file locks */
  }
});

test('htmlToText converts Riot rich text', () => {
  const t = htmlToText('<p>[Reaction] (Play any time.)<br />Give a unit -2 :rb_might: this turn.<br />:rb_energy_4:, :rb_exhaust:: Draw 1 [&gt;].</p><ul><li>Ready 2 runes.</li><li>Draw 1.</li></ul>');
  assert.equal(t, '[Reaction] (Play any time.)\nGive a unit -2 [Might] this turn.\n[4], [Exhaust]: Draw 1 [>].\n• Ready 2 runes.\n• Draw 1.');
  assert.equal(htmlToText(''), null);
  assert.equal(replaceGlyphTokens(':rb_energy_2::rb_rune_fury::rb_rune_rainbow:'), '[2][Fury][Any Rune]');
});

test('helpers: variants, tcg numbers, urls, ids', () => {
  const order = new Map([['OGN', 1], ['SFD', 3], ['VEN', 5]]);
  const totals = new Map<string, number | null>([['OGN', 298], ['SFD', 221], ['VEN', 166]]);
  const v = computeVariants(
    [
      { id: 'OGN-007', name: 'Fury Rune', type: 'Rune', set_code: 'OGN', number_int: 7, suffix: '', rarity: 'Common' },
      { id: 'OGN-007a', name: 'Fury Rune', type: 'Rune', set_code: 'OGN', number_int: 7, suffix: 'a', rarity: 'Showcase' },
      { id: 'VEN-R01', name: 'Fury Rune', type: 'Rune', set_code: 'VEN', number_int: 1, suffix: '', rarity: 'Common' },
      { id: 'OGN-299', name: 'Daughter of the Void', type: 'Legend', set_code: 'OGN', number_int: 299, suffix: '', rarity: 'Showcase' },
      { id: 'OGN-250', name: 'Daughter of the Void', type: 'Legend', set_code: 'OGN', number_int: 250, suffix: '', rarity: 'Epic' },
      { id: 'SFD-227s', name: 'Ahri, Inquisitive', type: 'Unit', set_code: 'SFD', number_int: 227, suffix: 's', rarity: 'Showcase' },
      { id: 'SFD-227', name: 'Ahri, Inquisitive', type: 'Unit', set_code: 'SFD', number_int: 227, suffix: '', rarity: 'Showcase' },
      { id: 'SFD-050a', name: 'Some Unit', type: 'Unit', set_code: 'SFD', number_int: 50, suffix: 'a', rarity: 'Rare' },
      { id: 'SFD-050', name: 'Some Unit', type: 'Unit', set_code: 'SFD', number_int: 50, suffix: '', rarity: 'Rare' },
    ],
    order,
    totals,
  );
  assert.deepEqual(v.get('OGN-007'), { variant_of: null, variant_kind: null });
  assert.deepEqual(v.get('OGN-007a'), { variant_of: 'OGN-007', variant_kind: 'showcase' });
  assert.deepEqual(v.get('VEN-R01'), { variant_of: 'OGN-007', variant_kind: 'reprint' });
  assert.deepEqual(v.get('OGN-299'), { variant_of: 'OGN-250', variant_kind: 'overnumbered' });
  assert.deepEqual(v.get('SFD-227s'), { variant_of: 'SFD-227', variant_kind: 'signature' });
  assert.deepEqual(v.get('SFD-050a'), { variant_of: 'SFD-050', variant_kind: 'alt_art' });
  assert.equal(normalizeName("Kai'Sa, Daughter  of the Void"), 'kai sa daughter of the void');

  assert.deepEqual(parseTcgNumber('066/298'), { prefix: '', number_int: 66, suffix: '', total: 298 });
  assert.deepEqual(parseTcgNumber('007a/298'), { prefix: '', number_int: 7, suffix: 'a', total: 298 });
  assert.deepEqual(parseTcgNumber('299*/298'), { prefix: '', number_int: 299, suffix: 's', total: 298 });
  assert.deepEqual(parseTcgNumber('SP3/006'), { prefix: 'SP', number_int: 3, suffix: '', total: 6 });
  assert.deepEqual(parseTcgNumber('R04'), { prefix: 'R', number_int: 4, suffix: '', total: null });
  assert.deepEqual(parseTcgNumber('T01a'), { prefix: 'T', number_int: 1, suffix: 'a', total: null });
  assert.equal(parseTcgNumber('Box Set'), null);
  const m = matchGroupsToSets(
    [
      { groupId: 1, name: 'Origins', abbreviation: 'OGN' },
      { groupId: 2, name: 'Origins: Proving Grounds', abbreviation: 'OGS' },
      { groupId: 3, name: 'Riftbound Promotional Cards', abbreviation: 'PR' },
      { groupId: 4, name: 'Spiritforged Something' },
    ],
    [
      { code: 'OGN', name: 'Origins', printed_total: 298 },
      { code: 'OGS', name: 'Proving Grounds', printed_total: 24 },
      { code: 'SFD', name: 'Spiritforged', printed_total: 221 },
    ],
  );
  assert.deepEqual(m.map((x) => `${x.group.groupId}:${x.set.code}`), ['1:OGN', '2:OGS', '4:SFD']);

  assert.equal(riotVariantUrl('https://x/y.png?accountingTag=RB', 'portrait', 'full'), 'https://x/y.png?accountingTag=RB&fm=webp&w=744&q=80');
  assert.equal(riotVariantUrl('https://x/y.png', 'landscape', 'thumb'), 'https://x/y.png?fm=webp&h=300&q=75');
  assert.equal(dotggImageUrl('OGN-303s'), 'https://static.dotgg.gg/riftbound/cards/OGN-303-STAR.webp');
  assert.equal(codeToId('OGN-043/298'), 'OGN-043');
  assert.equal(codeToId('ogn-304-star-298'), 'OGN-304s');
  assert.equal(codeToId('UNL-T01'), 'UNL-T01');
  assert.equal(codeToId('OGN-066-P'), null);
  assert.equal(deckId('riftools', 'x').length, 16);
});

test('cards job: localjson fixture, idempotent second run', async () => {
  const r1 = await runCards(ctx({ file: fixture('cards.sample.json') }));
  assert.equal(r1.changed, true);
  assert.equal(r1.failed, 0);
  assert.equal(count('cards'), 14);
  assert.equal(count('sets'), 5);
  const changesAfter1 = count('changes');
  assert.equal(count('changes', "kind='catalog' AND reason='cards'"), 1);
  assert.equal(getSetting<number>(db, 'catalog_version', 1), 2);

  const card = (id: string) => one<Record<string, unknown>>(db, 'SELECT * FROM cards WHERE id = ?', id)!;
  assert.equal(card('OGN-007a').variant_of, 'OGN-007');
  assert.equal(card('OGN-007a').variant_kind, 'showcase');
  assert.equal(card('SFD-227s').variant_of, 'SFD-227');
  assert.equal(card('SFD-227s').variant_kind, 'signature');
  assert.equal(card('OGN-299').variant_of, 'OGN-250');
  assert.equal(card('OGN-299').variant_kind, 'overnumbered');
  assert.equal(card('OGN-304s').variant_of, 'OGN-257');
  assert.equal(card('VEN-R01').variant_of, 'OGN-007');
  assert.equal(card('VEN-R01').variant_kind, 'reprint');
  assert.equal(card('OGN-007').variant_of, null);
  assert.equal(card('UNL-T01').orientation, 'landscape');
  assert.equal(card('UNL-T01').number, 'T01');
  assert.equal(card('UNL-T01').number_int, 1);
  // join applied (incl. '-STAR' normalisation, '-P' promos ignored)
  assert.equal(card('OGN-007').tcgplayer_id, 652777);
  assert.equal(card('SFD-227s').tcgplayer_id, 664913);
  assert.equal(card('SFD-227s').has_normal, 0);
  assert.equal(card('OGN-045').tcgplayer_id, 652821);
  assert.equal(card('OGN-043').flavor, '“Just a little closer…”');
  assert.equal(card('OGN-043').rules_text, '[Reaction] (Play any time, even before spells and abilities resolve.)\nGive a unit -2 [Might] this turn.\n[Predict]. (Look at the top card of your Main Deck. You may recycle it.)');
  assert.equal(card('OGN-045').rules_text, '[Reaction]\nChoose one —\n• Counter an ability.\n• Draw 1.');
  assert.equal(card('OGN-250').rules_text, '[4], [Exhaust]: Play a 3 [Might] Void unit token.');
  const sets = all<{ code: string; sort_order: number; printed_total: number }>(db, 'SELECT code, sort_order, printed_total FROM sets ORDER BY sort_order');
  assert.deepEqual(sets.map((s) => s.code), ['OGN', 'OGS', 'SFD', 'UNL', 'VEN']);

  const r2 = await runCards(ctx({ file: fixture('cards.sample.json') }));
  assert.equal(r2.changed, false);
  assert.equal(count('changes'), changesAfter1);
  assert.equal(getSetting<number>(db, 'catalog_version', 1), 2);
});

test('products job: fixture (one product skipped for an unknown card), idempotent', async () => {
  const r1 = await runProducts(ctx({ file: fixture('products.sample.json') }));
  assert.equal(r1.changed, true);
  assert.equal(r1.failed, 1);
  assert.match(r1.message ?? '', /bad-product/);
  assert.match(r1.message ?? '', /XXX-999/);
  assert.equal(count('products'), 2);
  assert.equal(one(db, "SELECT 1 AS x FROM products WHERE id='bad-product'"), undefined);
  // duplicate (card,finish) lines merged: OGN-007 6+6 → 12
  const rune = one<{ qty: number }>(db, "SELECT qty FROM product_contents WHERE product_id='ogs-master-yi' AND card_id='OGN-007' AND finish='normal'");
  assert.equal(Number(rune?.qty), 12);
  assert.equal(count('product_contents', "product_id='ogs-master-yi'"), 5);
  assert.equal(Number(one<{ f: number }>(db, "SELECT fixed_contents AS f FROM products WHERE id='ogn-booster'")?.f), 0);
  assert.equal(count('changes', "kind='catalog' AND reason='products'"), 1);
  const changes = count('changes');
  const r2 = await runProducts(ctx({ file: fixture('products.sample.json') }));
  assert.equal(r2.changed, false);
  assert.equal(count('changes'), changes);
  // missing seed reports cleanly
  const r3 = await runProducts(ctx({ file: path.join(tmp, 'nope.json') }));
  assert.equal(r3.failed, 0);
  assert.match(r3.message ?? '', /seed missing/);
});

test('prices job: localjson fixture', async () => {
  const r = await runPrices(ctx({ file: fixture('prices.sample.json') }));
  assert.equal(r.changed, true);
  assert.equal(r.ok, 4); // XXX-999 unknown, OGN-045 all-null skipped
  assert.equal(count('prices'), 4);
  assert.equal(count('price_history'), 4);
  const p = one<{ usd_market: number; source: string }>(db, "SELECT usd_market, source FROM prices WHERE card_id='SFD-227s' AND finish='foil'");
  assert.equal(Number(p?.usd_market), 2499.95);
  assert.equal(count('changes', "kind='prices'"), 1);
  // rerun same day: same rows, one more change row (prices always broadcast), no duplicate history
  await runPrices(ctx({ file: fixture('prices.sample.json') }));
  assert.equal(count('prices'), 4);
  assert.equal(count('price_history'), 4);
  assert.equal(count('changes', "kind='prices'"), 2);
  // unknown source name
  await assert.rejects(runPrices(ctx({ source: 'nope' })), /unknown price source/);
});

test('fx job: --rate bypasses network; unchanged rate within 24h writes no change row', async () => {
  const r1 = await runFx(ctx({ rate: 4.5 }));
  assert.equal(r1.ok, 1);
  assert.equal(r1.changed, true);
  assert.equal(count('fx_rates'), 1);
  assert.equal(count('changes', "kind='fx'"), 1);
  const r2 = await runFx(ctx({ rate: 4.5 }));
  assert.equal(r2.changed, false);
  assert.equal(count('changes', "kind='fx'"), 1);
  const r3 = await runFx(ctx({ rate: 4.6 }));
  assert.equal(r3.changed, true);
  assert.equal(count('changes', "kind='fx'"), 2);
  assert.equal(Number(one<{ rate: number }>(db, "SELECT rate FROM fx_rates WHERE base='USD' AND quote='MYR'")?.rate), 4.6);
  const bad = await runFx(ctx({ rate: 99 }));
  assert.equal(bad.failed, 1);
});

test('meta job: localjson decks resolve to canonical ids, old decks deactivated, idempotent', async () => {
  const r1 = await runMeta(ctx({ file: fixture('decks.sample.json') }));
  assert.equal(r1.ok, 2);
  assert.equal(r1.changed, true);
  assert.equal(count('meta_decks'), 2);
  assert.equal(count('meta_decks', 'active = 1'), 1);
  const d1 = one<Record<string, unknown>>(db, "SELECT * FROM meta_decks WHERE source_url='local://deck/master-yi-1'")!;
  assert.equal(d1.legend_card_id, 'OGS-019'); // resolved by legend name ("Master Yi, Wuju Bladesman" → "Wuju Bladesman")
  assert.equal(d1.champion_card_id, 'UNL-113');
  assert.equal(d1.placement, 1);
  assert.equal(d1.event_tier, 'premier');
  const unresolved = JSON.parse(String(d1.unresolved)) as Array<{ code: string }>;
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].code, 'XXX-999/100');
  const cards = all<{ card_id: string; section: string; qty: number }>(db, 'SELECT card_id, section, qty FROM meta_deck_cards WHERE deck_id = ? ORDER BY section, card_id', String(d1.id));
  // runes: OGN-007a + VEN-R01 both → canonical OGN-007 (6+6)
  assert.deepEqual(
    cards.map((c) => `${c.section}:${c.card_id}:${Number(c.qty)}`),
    ['battlefield:UNL-T01:1', 'champion:UNL-113:1', 'legend:OGS-019:1', 'main:OGN-043:3', 'main:OGN-045:2', 'runes:OGN-007:12', 'side:OGN-045:1'],
  );
  const d2 = one<Record<string, unknown>>(db, "SELECT * FROM meta_decks WHERE source_url='local://deck/lee-sin-old'")!;
  assert.equal(d2.active, 0);
  assert.equal(d2.legend_card_id, 'OGN-257'); // OGN-304* → OGN-304s → canonical OGN-257
  assert.equal(count('changes', "kind='catalog' AND reason='meta'"), 1);
  const changes = count('changes');
  const r2 = await runMeta(ctx({ file: fixture('decks.sample.json') }));
  assert.equal(r2.ok, 2);
  // the old deck is re-upserted as active=1 then deactivated again → counts as a change; the fresh one is unchanged
  assert.equal(count('meta_decks', 'active = 1'), 1);
  assert.ok(count('changes') >= changes);
});
