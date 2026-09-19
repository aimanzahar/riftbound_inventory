/// <reference lib="dom" />
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ensureDataDirs } from '../config.ts';
import { all, one, openDb, getSetting, run as sql } from '../db/open.ts';
import { migrate } from '../db/migrate.ts';
import { run as syncCards } from '../../sync/cards.ts';
import { run as syncImages, riotVariantUrl } from '../../sync/images.ts';
import { parseDotggCatalog, type Indexed } from '../../sync/sources/cards.dotgg.ts';
import type { RiotCardItem } from '../../sync/sources/cards.riot.ts';
import type { JobCtx } from '../../sync/types.ts';
import { buildCatalog, invalidateCatalogCache } from '../services/catalog.ts';
import { applyInventory, normalizeCardId } from '../services/inventory.ts';
import { createDeck, applyDeckCards } from '../services/decks.ts';
import { exportCsv } from '../services/exportCsv.ts';
import { parseCsv } from '../../shared/csv.ts';
import { searchCards } from '../../shared/search.ts';
import { computeVisibleIds } from '../../web/src/store/selectors.ts';
import { EMPTY_FILTERS } from '../../web/src/store/types.ts';
import { fetchTcgcsvPrices } from '../../sync/sources/prices.tcgcsv.ts';
import { makeClient, openSse, startServer } from './helpers.ts';
import type { Catalog, Change, InventoryResponse } from '../../shared/types.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/cards.printings.json', import.meta.url), 'utf8')) as { riot: { data: RiotCardItem[] }; dotgg: Indexed };
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function setup(t: TestContext): JobCtx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-catalog-'));
  const cfg = loadConfig([], { DATA_DIR: dir, NO_SCHEDULER: '1' });
  ensureDataDirs(cfg);
  const db = openDb(cfg.dbPath);
  migrate(db, cfg.migrationsDir);
  invalidateCatalogCache();
  t.after(() => { db.close(); invalidateCatalogCache(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { cfg, db, log: silent, flags: {}, trigger: 'manual', signal: new AbortController().signal, progress() {}, afterCommit() {} };
}

function mockFeeds(t: TestContext) {
  const state = { riot: structuredClone(fixture.riot.data), dotgg: structuredClone(fixture.dotgg), riotDown: false, dotggDown: false };
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
    if (url.includes('api.dotgg.gg')) return state.dotggDown ? new Response('unavailable', { status: 403 }) : Response.json(state.dotgg);
    if (url.includes('riftbound_gallery_sets')) return state.riotDown ? new Response('unavailable', { status: 403 }) : Response.json({ data: [
      { id: 'OGN', name: 'Origins', collectorNumberMax: 298 }, { id: 'SFD', name: 'Spiritforged', collectorNumberMax: 221 },
      { id: 'UNL', name: 'Unleashed', collectorNumberMax: 219 }, { id: 'VEN', name: 'Vendetta', collectorNumberMax: 166 },
    ] });
    if (url.includes('riftbound_gallery_cards')) return Response.json({ data: state.riot, metadata: { totalItems: state.riot.length } });
    throw new Error(`Unexpected fetch in offline test: ${url}`);
  });
  return state;
}

test('imports every Rune family and distinct promo printing, then repeats without changes', async (t) => {
  const ctx = setup(t);
  const feeds = mockFeeds(t);
  feeds.dotgg.data!.push(feeds.dotgg.data![0]);
  const first = await syncCards(ctx);
  assert.equal(first.failed, 0);
  assert.equal(first.changed, true);
  const { catalog } = buildCatalog(ctx.db);
  const runes = catalog.cards.filter((c) => c.type === 'Rune');
  assert.equal(runes.length, 72);
  assert.equal(runes.filter((c) => !fixture.riot.data.some((r) => r.id === c.riot_id)).length, 54);
  for (const set of ['SFD', 'UNL', 'VEN']) for (let n = 1; n <= 6; n++) for (const suffix of ['', 'a']) {
    assert.ok(runes.some((c) => c.id === `${set}-R0${n}${suffix}`));
  }
  for (const id of ['VEN-R01b-P', 'SFD-139-P2', 'UNL-058-P', 'UNL-058-P-CHAMPION', 'OGN-279-OVERSIZED', 'OGN-P', 'SGN-001-P', 'OGN-263a', 'ARC-001', 'T1A-001-P']) {
    assert.ok(catalog.cards.some((c) => c.id === id), id);
  }
  const promo = runes.find((c) => c.id === 'VEN-R01b-P')!;
  assert.equal(promo.variant_of, 'OGN-007');
  assert.equal(promo.variant_kind, 'promo');
  assert.equal(promo.has_normal, 0);
  assert.match(promo.name, /Nexus Night/);
  assert.match(promo.image_url!, /VEN-R01B-P/);
  assert.equal(catalog.cards.find((c) => c.id === 'OGN-279-OVERSIZED')?.variant_of, 'OGN-279');
  assert.ok(catalog.sets.some((s) => s.code === 'SGN'));
  assert.equal(all(ctx.db, 'SELECT * FROM inventory').length, 0);
  const second = await syncCards(ctx);
  assert.equal(second.changed, false);
  assert.equal(getSetting(ctx.db, 'catalog_version', 0), catalog.catalog_version);
  assert.equal(all(ctx.db, "SELECT * FROM changes WHERE kind='catalog'").length, 1);
});

test('outages and smaller feeds preserve cards, inventory, notes, tips and deck references', async (t) => {
  const ctx = setup(t);
  const feeds = mockFeeds(t);
  await syncCards(ctx);
  const cardId = 'VEN-R01b-P';
  applyInventory(ctx.db, { op_id: crypto.randomUUID(), mode: 'add', reason: 'manual', device: null,
    items: [{ card_id: cardId, finish: 'foil', qty: 4, note: 'Keep this printing' }] });
  const deck = createDeck(ctx.db, { op_id: crypto.randomUUID(), name: 'Rune test' }, null).deck!;
  applyDeckCards(ctx.db, deck.id, { op_id: crypto.randomUUID(), mode: 'set', device: null, items: [{ card_id: cardId, section: 'runes', qty: 4 }] });
  sql(ctx.db, "INSERT INTO tips(card_id,text,source) VALUES (?,?,'user')", cardId, 'My note');
  const saved = ['inventory', 'user_deck_cards', 'tips'].map((table) => all(ctx.db, `SELECT * FROM ${table}`));
  const count = all(ctx.db, 'SELECT id FROM cards').length;
  feeds.dotggDown = true;
  assert.ok((await syncCards(ctx)).failed > 0);
  assert.equal(all(ctx.db, 'SELECT id FROM cards WHERE active=1').length, count);
  feeds.dotggDown = false;
  feeds.riotDown = true;
  const official = one(ctx.db, "SELECT riot_id, name, domains, image_url FROM cards WHERE id='OGN-007'");
  assert.ok((await syncCards(ctx)).failed > 0);
  assert.deepEqual(one(ctx.db, "SELECT riot_id, name, domains, image_url FROM cards WHERE id='OGN-007'"), official);
  feeds.riotDown = false;
  feeds.dotgg.data = feeds.dotgg.data!.slice(0, 1);
  feeds.riot = feeds.riot.slice(0, 1);
  await syncCards(ctx);
  assert.equal(all(ctx.db, 'SELECT id FROM cards WHERE active=1').length, count);
  assert.deepEqual(['inventory', 'user_deck_cards', 'tips'].map((table) => all(ctx.db, `SELECT * FROM ${table}`)), saved);
  feeds.riotDown = feeds.dotggDown = true;
  const before = all(ctx.db, 'SELECT * FROM cards');
  const version = getSetting(ctx.db, 'catalog_version', 0);
  await assert.rejects(syncCards(ctx), /unavailable/);
  assert.deepEqual(all(ctx.db, 'SELECT * FROM cards'), before);
  assert.equal(getSetting(ctx.db, 'catalog_version', 0), version);
});

test('source diagnostics report malformed rows without losing valid cards', () => {
  const payload = structuredClone(fixture.dotgg);
  payload.data!.push(['../../unsafe', 'Bad card']);
  const result = parseDotggCatalog(payload);
  assert.equal(result.diagnostics?.failed, 1);
  assert.equal(result.cards.filter((c) => c.type === 'Rune').length, 72);
  assert.throws(() => parseDotggCatalog({ names: ['id'], data: [] }), /unexpected payload/);
});

test('new printings reach catalog API and SSE, Rune filtering, exact search and inventory CSV', async (t) => {
  const ctx = setup(t);
  mockFeeds(t);
  const srv = await startServer({ dataDir: ctx.cfg.dataDir, seed: false });
  t.after(() => srv.stop());
  const api = makeClient(srv.baseUrl);
  assert.equal((await api.get<Catalog>('/api/catalog')).body.cards.length, 0);
  const events = await openSse(`${srv.baseUrl}/api/events`);
  t.after(() => events.close());
  await syncCards(ctx);
  const event = await events.waitFor((e) => e.event === 'change' && e.json<Change>().kind === 'catalog', 5000);
  assert.equal(event.json<Change>().reason, 'cards');
  const { body: catalog } = await api.get<Catalog>('/api/catalog');
  const ids = computeVisibleIds({ cards: catalog.cards, sets: catalog.sets, filters: { ...EMPTY_FILTERS, types: ['Rune'] }, search: '', sort: 'number',
    inventory: new Map(), prices: new Map(), usage: new Map(), ownedByCanonical: new Map(), playset: 3, runePlayset: 12 });
  assert.equal(ids.length, 72);
  assert.equal(searchCards('ven-r01b-p', catalog.cards)[0]?.id, 'VEN-R01b-P');
  const added = await api.post<InventoryResponse>('/api/inventory', { op_id: crypto.randomUUID(), mode: 'add', reason: 'manual',
    items: [{ card_id: 'ven-r01B-p', finish: 'foil', qty: 2 }, { card_id: 'OGN-P', finish: 'foil', qty: 1 }] });
  assert.equal(added.status, 200);
  const rows = parseCsv(exportCsv(ctx.db)).slice(1);
  assert.deepEqual(rows.map((r) => normalizeCardId(r[0])).sort(), ['OGN-P', 'VEN-R01b-P']);
  assert.equal(rows.find((r) => r[0] === 'VEN-R01b-P')?.[5], '2');
});

test('supplementary image URLs are fetched verbatim and mirrored safely', async (t) => {
  const ctx = setup(t);
  mockFeeds(t);
  await syncCards(ctx);
  // Isolate one mixed-case promo URL; downloading must not reconstruct it from the normalized ID.
  sql(ctx.db, "UPDATE cards SET active=0 WHERE id<>'VEN-R01b-P'");
  const remote = one<{ image_url: string }>(ctx.db, "SELECT image_url FROM cards WHERE id='VEN-R01b-P'")!.image_url;
  assert.equal(riotVariantUrl(remote, 'portrait', 'thumb'), remote);
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    requested.push(String(input));
    return new Response(Buffer.alloc(2500), { headers: { 'content-type': 'image/webp' } });
  });
  assert.equal((await syncImages(ctx)).failed, 0);
  assert.ok(requested.every((url) => url === remote));
  assert.ok(fs.existsSync(path.join(ctx.cfg.thumbsDir, 'VEN-R01b-P.webp')));
  assert.equal((await syncImages(ctx)).ok, 0);
});

test('market IDs separate promo prices from regular cards with the same printed number', async (t) => {
  const ctx = setup(t);
  mockFeeds(t);
  await syncCards(ctx);
  const regular = one<{ tcgplayer_id: number }>(ctx.db, "SELECT tcgplayer_id FROM cards WHERE id='OGN-066'")!.tcgplayer_id;
  const promo = one<{ tcgplayer_id: number }>(ctx.db, "SELECT tcgplayer_id FROM cards WHERE id='OGN-066-P'")!.tcgplayer_id;
  assert.notEqual(regular, promo);
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (url.endsWith('/groups')) return Response.json({ results: [{ groupId: 1, abbreviation: 'OGN', name: 'Origins' }] });
    if (url.endsWith('/products')) return Response.json({ results: [regular, promo].map((productId) => ({ productId, name: 'Ahri', extendedData: [{ name: 'Number', value: '066/298' }] })) });
    if (url.endsWith('/prices')) return Response.json({ results: [regular, promo].map((productId, i) => ({ productId, subTypeName: 'Foil', marketPrice: i ? 100 : 1 })) });
    throw new Error(url);
  });
  const prices = new Map<string, number | null>();
  await fetchTcgcsvPrices(ctx, (group) => group.rows.forEach((row) => prices.set(row.card_id, row.usd_market)));
  assert.equal(prices.get('OGN-066'), 1);
  assert.equal(prices.get('OGN-066-P'), 100);
});
