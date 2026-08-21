// End-to-end API tests against a freshly spawned server (PORT=0, temp DATA_DIR, seeded catalog).
// Subtests run sequentially and build on each other's inventory state; card ids used per step are
// chosen so the product tests (8) see none of their cards touched by the earlier steps.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEVICE_ID, SEED_BOOSTER, SEED_CARDS, SEED_PRODUCT, SEED_PRODUCT_COPIES, makeClient, openSse, startServer, type ApiClient, type TestServer } from './helpers.ts';
import { parseCsv } from '../../shared/csv.ts';
import { CSV_HEADER } from '../../shared/constants.ts';
import type { ApiError, Catalog, Change, Finish, InventoryPayload, InventoryResponse, PurchasePreview, State, Tip, TipPayload } from '../../shared/types.ts';

const PRODUCT = SEED_PRODUCT.id;

describe('api', { timeout: 120_000 }, () => {
  let srv: TestServer;
  let api: ApiClient;

  before(async () => {
    srv = await startServer();
    api = makeClient(srv.baseUrl);
  });
  after(async () => {
    await srv?.stop();
  });

  // ---- small helpers -----------------------------------------------------------------------
  const state = async (): Promise<State> => {
    const r = await api.get<State>('/api/state');
    assert.equal(r.status, 200, r.text);
    return r.body;
  };
  const health = async (): Promise<{ ok: boolean; seq: number; clients: number }> => (await api.get<{ ok: boolean; seq: number; clients: number }>('/api/health')).body;
  const qtyOf = (s: State, card_id: string, finish: Finish = 'normal') => s.inventory.find((r) => r.card_id === card_id && r.finish === finish)?.qty ?? 0;
  const noteOf = (s: State, card_id: string, finish: Finish = 'normal') => s.inventory.find((r) => r.card_id === card_id && r.finish === finish)?.note ?? '';
  const inv = (body: Record<string, unknown>) => api.post<InventoryResponse & ApiError>('/api/inventory', { op_id: randomUUID(), reason: 'manual', ...body });
  const add = (card_id: string, qty: number, finish: Finish = 'normal') => inv({ mode: 'add', items: [{ card_id, finish, qty }] });
  const payload = (c: Change | undefined) => {
    assert.ok(c, 'expected a change');
    return c.payload as InventoryPayload;
  };
  const preview = async (qty = 1): Promise<PurchasePreview> => {
    const r = await api.get<PurchasePreview>(`/api/products/${PRODUCT}/preview?qty=${qty}`);
    assert.equal(r.status, 200, r.text);
    return r.body;
  };

  // ---- 0. smoke + identity -----------------------------------------------------------------
  it('health + 404/405 + device registration', async () => {
    const h = await health();
    assert.equal(h.ok, true);
    assert.equal(h.seq, 0);

    const nf = await api.get<ApiError>('/api/nope');
    assert.equal(nf.status, 404);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    const mna = await api.post<ApiError>('/api/state', {});
    assert.equal(mna.status, 405);

    const dev = await api.put<{ device: { id: string; name: string; color: string } }>(`/api/devices/${DEVICE_ID}`, { name: 'Tester', color: '#22c55e' });
    assert.equal(dev.status, 200, dev.text);
    assert.deepEqual({ id: dev.body.device.id, name: dev.body.device.name, color: dev.body.device.color }, { id: DEVICE_ID, name: 'Tester', color: '#22c55e' });
    const other = await api.put<ApiError>(`/api/devices/someone-else`, { name: 'X', color: '#000000' });
    assert.equal(other.status, 403);

    const s = await state();
    assert.equal(s.seq, 0);
    assert.equal(s.inventory.length, 0);
    assert.ok(s.devices.some((d) => d.id === DEVICE_ID && d.name === 'Tester'));
    assert.equal(s.settings.playset_size, 3);
    assert.equal(s.settings.rune_playset_size, 12);
  });

  // ---- 1. concurrency ----------------------------------------------------------------------
  it('1. 50 parallel +1 on OGN-001 → qty 50, 50 serialized change rows', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => add('OGN-001', 1)));
    for (const r of results) {
      assert.equal(r.status, 200, r.text);
      assert.ok(r.body.change, r.text);
      assert.equal(r.body.replayed, undefined);
      assert.equal(r.body.noop, undefined);
      assert.equal(r.body.change.kind, 'inventory');
      assert.equal(r.body.change.reason, 'manual');
      assert.equal(r.body.change.entity, 'OGN-001');
      assert.equal(r.body.change.device?.name, 'Tester');
    }
    const seqs = results.map((r) => r.body.change!.seq);
    assert.equal(new Set(seqs).size, 50, 'every change has its own seq');
    // the deltas were applied strictly one after another: prev_qty chain 0..49
    const lines = results.map((r) => payload(r.body.change).lines[0]).sort((a, b) => a.prev_qty - b.prev_qty);
    lines.forEach((l, i) => {
      assert.equal(l.card_id, 'OGN-001');
      assert.equal(l.prev_qty, i);
      assert.equal(l.qty, i + 1);
    });
    const s = await state();
    assert.equal(qtyOf(s, 'OGN-001'), 50);
    assert.equal(s.seq, Math.max(...seqs));
  });

  // ---- 2. idempotency ----------------------------------------------------------------------
  it('2. same op_id twice → second replayed:true, only one change row, qty applied once', async () => {
    const body = { op_id: randomUUID(), reason: 'manual', mode: 'add', items: [{ card_id: 'OGN-002', finish: 'normal', qty: 2 }] };
    const first = await api.post<InventoryResponse>('/api/inventory', body);
    assert.equal(first.status, 200, first.text);
    assert.ok(first.body.change);
    assert.equal(first.body.replayed, undefined);
    const second = await api.post<InventoryResponse>('/api/inventory', body);
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.change?.seq, first.body.change.seq);
    assert.equal(second.body.change?.op_id, body.op_id);

    const ch = await api.get<{ changes: Change[] }>('/api/changes?card_id=OGN-002');
    assert.equal(ch.status, 200);
    assert.equal(ch.body.changes.length, 1);
    assert.equal(ch.body.changes[0].seq, first.body.change.seq);
    assert.equal(qtyOf(await state(), 'OGN-002'), 2);
  });

  // ---- 3. clamping -------------------------------------------------------------------------
  it('3. −1 at qty 0 → qty stays 0 and the line is flagged clamped', async () => {
    const r = await add('OGN-011', -1);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.change, `expected a change (got ${r.text})`);
    const p = payload(r.body.change);
    assert.equal(p.lines.length, 1);
    assert.deepEqual(
      { card_id: p.lines[0].card_id, qty: p.lines[0].qty, prev_qty: p.lines[0].prev_qty, clamped: p.lines[0].clamped },
      { card_id: 'OGN-011', qty: 0, prev_qty: 0, clamped: true },
    );
    assert.equal(p.summary.clamped, 1);
    assert.equal(p.summary.copies_delta, 0);
    assert.equal(qtyOf(await state(), 'OGN-011'), 0);

    // over-subtracting clamps too: 2 − 5 → 0 (prev 2), not −3
    assert.equal((await add('OGN-011', 2)).status, 200);
    const r2 = await add('OGN-011', -5);
    const l2 = payload(r2.body.change).lines[0];
    assert.deepEqual({ qty: l2.qty, prev_qty: l2.prev_qty, clamped: l2.clamped }, { qty: 0, prev_qty: 2, clamped: true });
    assert.equal(payload(r2.body.change).summary.copies_delta, -2);
    assert.equal(qtyOf(await state(), 'OGN-011'), 0);
  });

  // ---- 4. validation: unknown ids are atomic -----------------------------------------------
  it('4. one unknown id → 400 VALIDATION with unknown_ids, nothing applied', async () => {
    const before = await health();
    const r = await inv({
      mode: 'add',
      items: [
        { card_id: 'OGN-013', finish: 'normal', qty: 1 },
        { card_id: 'ogn-999', finish: 'normal', qty: 1 },
      ],
    });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.body.error.code, 'VALIDATION');
    assert.deepEqual(r.body.error.unknown_ids, ['OGN-999']);
    const s = await state();
    assert.equal(qtyOf(s, 'OGN-013'), 0);
    assert.equal(s.seq, before.seq, 'no change row was written');

    // other validation failures
    const bad = async (body: Record<string, unknown>, code = 'VALIDATION') => {
      const x = await api.post<ApiError>('/api/inventory', body);
      assert.equal(x.status, 400, x.text);
      assert.equal(x.body.error.code, code);
    };
    await bad({ op_id: 'short', reason: 'manual', mode: 'add', items: [{ card_id: 'OGN-001', qty: 1 }] });
    await bad({ op_id: randomUUID(), reason: 'product', mode: 'add', items: [{ card_id: 'OGN-001', qty: 1 }] });
    await bad({ op_id: randomUUID(), reason: 'manual', mode: 'teleport', items: [{ card_id: 'OGN-001', qty: 1 }] });
    await bad({ op_id: randomUUID(), reason: 'manual', mode: 'add', items: [] });
    await bad({ op_id: randomUUID(), reason: 'manual', mode: 'add', items: [{ card_id: 'OGN-001' }] });
    await bad({ op_id: randomUUID(), reason: 'manual', mode: 'add', items: [{ card_id: 'OGN-001', finish: 'etched', qty: 1 }] });
    await bad({ op_id: randomUUID(), reason: 'manual', mode: 'add', items: [{ card_id: 'OGN-001', qty: 1.5 }] });
    await bad({ op_id: randomUUID(), reason: 'manual', mode: 'set', items: [{ card_id: 'OGN-001', qty: -1 }] });
    const notJson = await api.req<ApiError>('POST', '/api/inventory', undefined, { 'Content-Type': 'application/json' });
    assert.equal(notJson.status, 400);
    assert.equal(s.seq, (await health()).seq, 'validation failures never write');
  });

  // ---- 5. set mode + notes -----------------------------------------------------------------
  it('5. set mode writes an absolute qty and a note; note-only edits keep qty', async () => {
    const r = await inv({ mode: 'set', items: [{ card_id: 'OGN-003', finish: 'foil', qty: 4, note: 'signed by artist' }] });
    assert.equal(r.status, 200, r.text);
    const p = payload(r.body.change);
    assert.equal(p.mode, 'set');
    assert.deepEqual(p.lines, [{ card_id: 'OGN-003', finish: 'foil', qty: 4, prev_qty: 0, note: 'signed by artist', prev_note: '' }]);
    assert.equal(p.summary.copies_delta, 4);
    let s = await state();
    assert.equal(qtyOf(s, 'OGN-003', 'foil'), 4);
    assert.equal(noteOf(s, 'OGN-003', 'foil'), 'signed by artist');
    assert.equal(qtyOf(s, 'OGN-003', 'normal'), 0);

    const n = await inv({ reason: 'note', mode: 'set', items: [{ card_id: 'OGN-003', finish: 'foil', note: 'traded' }] });
    assert.equal(n.status, 200, n.text);
    assert.equal(n.body.change?.reason, 'note');
    assert.deepEqual(payload(n.body.change).lines, [{ card_id: 'OGN-003', finish: 'foil', qty: 4, prev_qty: 4, note: 'traded', prev_note: 'signed by artist' }]);
    assert.equal(payload(n.body.change).summary.copies_delta, 0);

    // a note on a card you do not own still shows up in state (qty 0, note set)
    const w = await inv({ reason: 'note', mode: 'set', items: [{ card_id: 'OGN-002', finish: 'foil', note: 'wishlist' }] });
    assert.equal(w.status, 200, w.text);
    s = await state();
    assert.equal(noteOf(s, 'OGN-003', 'foil'), 'traded');
    assert.equal(qtyOf(s, 'OGN-003', 'foil'), 4);
    assert.equal(noteOf(s, 'OGN-002', 'foil'), 'wishlist');
    assert.equal(qtyOf(s, 'OGN-002', 'foil'), 0);

    // setting the same value again is a no-op (no change row)
    const same = await inv({ mode: 'set', items: [{ card_id: 'OGN-003', finish: 'foil', qty: 4 }] });
    assert.equal(same.status, 200);
    assert.equal(same.body.noop, true);
    assert.equal(same.body.change, undefined);
  });

  // ---- 6. replace --------------------------------------------------------------------------
  let replaceSeq = 0;
  it('6. replace mode sets the listed cards and zeroes every other owned row', async () => {
    const r = await inv({ reason: 'csv', mode: 'replace', items: [{ card_id: 'OGN-043', finish: 'normal', qty: 7 }], csv_filename: 'test.csv' });
    assert.equal(r.status, 200, r.text);
    const p = payload(r.body.change);
    replaceSeq = r.body.change!.seq;
    assert.equal(p.mode, 'replace');
    assert.equal(p.csv_filename, 'test.csv');
    assert.equal(r.body.change?.reason, 'csv');
    const by = new Map(p.lines.map((l) => [`${l.card_id}:${l.finish}`, l]));
    assert.deepEqual(
      [...by.keys()].sort(),
      ['OGN-001:normal', 'OGN-002:normal', 'OGN-003:foil', 'OGN-043:normal'],
    );
    assert.deepEqual({ qty: by.get('OGN-043:normal')!.qty, prev_qty: by.get('OGN-043:normal')!.prev_qty }, { qty: 7, prev_qty: 0 });
    assert.deepEqual({ qty: by.get('OGN-001:normal')!.qty, prev_qty: by.get('OGN-001:normal')!.prev_qty }, { qty: 0, prev_qty: 50 });
    assert.deepEqual({ qty: by.get('OGN-002:normal')!.qty, prev_qty: by.get('OGN-002:normal')!.prev_qty }, { qty: 0, prev_qty: 2 });
    assert.deepEqual({ qty: by.get('OGN-003:foil')!.qty, prev_qty: by.get('OGN-003:foil')!.prev_qty, note: by.get('OGN-003:foil')!.note }, { qty: 0, prev_qty: 4, note: 'traded' });
    assert.equal(p.summary.copies_delta, 7 - 56);
    assert.equal(p.summary.cards, 4);

    const s = await state();
    const owned = s.inventory.filter((x) => x.qty > 0).map((x) => `${x.card_id}:${x.finish}=${x.qty}`);
    assert.deepEqual(owned, ['OGN-043:normal=7']);
    assert.equal(noteOf(s, 'OGN-003', 'foil'), 'traded', 'notes survive a replace');
    assert.equal(noteOf(s, 'OGN-002', 'foil'), 'wishlist');
  });

  // ---- 7. undo -----------------------------------------------------------------------------
  it('7. undo restores the previous quantities; a second undo → 409 ALREADY_UNDONE', async () => {
    const op = randomUUID();
    const u = await api.post<{ change: Change } & ApiError>(`/api/changes/${replaceSeq}/undo`, { op_id: op });
    assert.equal(u.status, 200, u.text);
    assert.equal(u.body.change.kind, 'inventory');
    assert.equal(u.body.change.reason, 'undo');
    assert.equal(u.body.change.undo_of, replaceSeq);
    const p = u.body.change.payload as InventoryPayload;
    assert.equal(p.summary.copies_delta, 56 - 7);
    assert.equal(p.summary.clamped, 0);

    const s = await state();
    assert.equal(qtyOf(s, 'OGN-001'), 50);
    assert.equal(qtyOf(s, 'OGN-002'), 2);
    assert.equal(qtyOf(s, 'OGN-003', 'foil'), 4);
    assert.equal(qtyOf(s, 'OGN-043'), 0);
    assert.equal(noteOf(s, 'OGN-003', 'foil'), 'traded');

    // retrying the same undo op is idempotent (same change back)
    const again = await api.post<{ change: Change }>(`/api/changes/${replaceSeq}/undo`, { op_id: op });
    assert.equal(again.status, 200, again.text);
    assert.equal(again.body.change.seq, u.body.change.seq);
    assert.equal((await state()).seq, u.body.change.seq);

    // a fresh attempt is rejected
    const twice = await api.post<ApiError>(`/api/changes/${replaceSeq}/undo`, { op_id: randomUUID() });
    assert.equal(twice.status, 409, twice.text);
    assert.equal(twice.body.error.code, 'ALREADY_UNDONE');

    // the feed marks the original as undone, the undo itself is not
    const feed = await api.get<{ changes: Change[] }>('/api/changes?limit=100');
    const orig = feed.body.changes.find((c) => c.seq === replaceSeq);
    const undo = feed.body.changes.find((c) => c.seq === u.body.change.seq);
    assert.equal(orig?.undone, true);
    assert.equal(undo?.undone, false);
    assert.equal(undo?.undo_of, replaceSeq);
    // feed is newest-first
    assert.equal(feed.body.changes[0].seq, u.body.change.seq);

    // unknown / non-inventory targets
    const missing = await api.post<ApiError>(`/api/changes/999999/undo`, { op_id: randomUUID() });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
    // undoing an undo is allowed and re-applies the replace
    const redo = await api.post<{ change: Change }>(`/api/changes/${u.body.change.seq}/undo`, { op_id: randomUUID() });
    assert.equal(redo.status, 200, redo.text);
    const s2 = await state();
    assert.equal(qtyOf(s2, 'OGN-043'), 7);
    assert.equal(qtyOf(s2, 'OGN-001'), 0);
    // … and undo that too so the rest of the suite sees the restored inventory
    const back = await api.post<{ change: Change }>(`/api/changes/${redo.body.change.seq}/undo`, { op_id: randomUUID() });
    assert.equal(back.status, 200, back.text);
    const s3 = await state();
    assert.equal(qtyOf(s3, 'OGN-001'), 50);
    assert.equal(qtyOf(s3, 'OGN-002'), 2);
    assert.equal(qtyOf(s3, 'OGN-003', 'foil'), 4);
    assert.equal(qtyOf(s3, 'OGN-043'), 0);
  });

  // ---- 8. products: preview / buy / undo ---------------------------------------------------
  it('8. product preview is green on an empty slice, red after buying (times_bought 1), green after undo', async () => {
    const fresh = await preview();
    assert.equal(fresh.product.id, PRODUCT);
    assert.equal(fresh.product.kind, 'champion_deck');
    assert.equal(fresh.summary.severity, 'green');
    assert.equal(fresh.times_bought, 0);
    assert.equal(fresh.last_bought, null);
    assert.equal(fresh.summary.copies, SEED_PRODUCT_COPIES);
    assert.equal(fresh.summary.distinct, SEED_PRODUCT.contents.length);
    assert.equal(fresh.summary.new_copies, SEED_PRODUCT_COPIES);
    assert.equal(fresh.summary.dup_copies, 0);
    assert.ok(fresh.lines.every((l) => l.owned_now === 0 && l.status === 'new'), 'none of the product cards are owned yet');
    // qty multiplies
    const twice = await preview(2);
    assert.equal(twice.qty, 2);
    assert.equal(twice.summary.copies, SEED_PRODUCT_COPIES * 2);

    const op = randomUUID();
    const buy = await api.post<{ change: Change } & ApiError>(`/api/products/${PRODUCT}/buy`, { op_id: op, qty: 1 });
    assert.equal(buy.status, 200, buy.text);
    assert.equal(buy.body.change.reason, 'product');
    assert.equal(buy.body.change.entity, PRODUCT);
    const bp = buy.body.change.payload as InventoryPayload;
    assert.deepEqual(bp.product, { id: PRODUCT, name: SEED_PRODUCT.name, qty: 1 });
    assert.equal(bp.summary.copies_delta, SEED_PRODUCT_COPIES);
    assert.equal(bp.lines.length, SEED_PRODUCT.contents.length);
    // idempotent
    const replay = await api.post<{ change: Change; replayed?: true }>(`/api/products/${PRODUCT}/buy`, { op_id: op, qty: 1 });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.change.seq, buy.body.change.seq);

    let s = await state();
    for (const c of SEED_PRODUCT.contents) assert.equal(qtyOf(s, c.card_id, c.finish), c.qty, c.card_id);
    assert.equal(s.purchases[0]?.product_id, PRODUCT);
    assert.equal(s.purchases[0]?.qty, 1);
    assert.equal(s.purchases[0]?.undone, false);
    assert.equal(s.purchases[0]?.seq, buy.body.change.seq);

    const after = await preview();
    assert.equal(after.summary.severity, 'red');
    assert.equal(after.times_bought, 1);
    assert.equal(after.last_bought?.device_name, 'Tester');
    assert.ok(after.lines.every((l) => l.status === 'owned' && l.owned_now === l.in_product), JSON.stringify(after.lines));
    assert.equal(after.summary.dup_copies, SEED_PRODUCT_COPIES);
    assert.equal(after.summary.new_copies, 0);
    assert.match(after.summary.headline, /already bought this ×1/);
    // the alt-art line counts base-printing copies too (canonical merge): add one OGN-036 and the OGN-036a line moves
    const baseAdd = await add('OGN-036', 1);
    assert.equal(baseAdd.status, 200);
    const merged = await preview();
    assert.equal(merged.lines.find((l) => l.card_id === 'OGN-036a')?.owned_now, 2);
    const undoBase = await api.post<{ change: Change }>(`/api/changes/${baseAdd.body.change!.seq}/undo`, { op_id: randomUUID() });
    assert.equal(undoBase.status, 200);

    const undo = await api.post<{ change: Change }>(`/api/changes/${buy.body.change.seq}/undo`, { op_id: randomUUID() });
    assert.equal(undo.status, 200, undo.text);
    assert.equal(undo.body.change.reason, 'undo');
    assert.equal(undo.body.change.entity, PRODUCT);
    s = await state();
    for (const c of SEED_PRODUCT.contents) assert.equal(qtyOf(s, c.card_id, c.finish), 0, c.card_id);
    assert.equal(s.purchases[0]?.seq, buy.body.change.seq);
    assert.equal(s.purchases[0]?.undone, true);

    const again = await preview();
    assert.equal(again.summary.severity, 'green');
    assert.equal(again.times_bought, 0);
    assert.equal(again.last_bought, null);

    // a product without a fixed list previews as "no list" and cannot be bought
    const booster = await api.get<PurchasePreview>(`/api/products/${SEED_BOOSTER.id}/preview`);
    assert.equal(booster.status, 200);
    assert.equal(booster.body.summary.distinct, 0);
    assert.equal(booster.body.summary.severity, 'green');
    assert.match(booster.body.summary.headline, /no fixed card list/);
    const nope = await api.post<ApiError>(`/api/products/${SEED_BOOSTER.id}/buy`, { op_id: randomUUID(), qty: 1 });
    assert.equal(nope.status, 409, nope.text);
    assert.equal(nope.body.error.code, 'NOT_PURCHASABLE');
    const missing = await api.get<ApiError>(`/api/products/does-not-exist/preview`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });

  // ---- 9. tips -----------------------------------------------------------------------------
  it("9. PUT /api/tips/:id saves a user tip and records a change of kind 'tip'", async () => {
    const text = 'Fires rockets at everything; pairs well with Get Excited! for lethal bursts.';
    const r = await api.put<{ tip: Tip; change: Change } & ApiError>('/api/tips/ogn-251', { op_id: randomUUID(), text });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.tip.card_id, 'OGN-251');
    assert.equal(r.body.tip.text, text);
    assert.equal(r.body.tip.source, 'user');
    assert.equal(r.body.tip.edited_by, DEVICE_ID);
    assert.equal(r.body.change.kind, 'tip');
    assert.equal(r.body.change.entity, 'OGN-251');
    assert.deepEqual(r.body.change.payload as TipPayload, { card_id: 'OGN-251', text, prev_text: null });

    const r2 = await api.put<{ tip: Tip; change: Change }>('/api/tips/OGN-251', { op_id: randomUUID(), text: '  Short tip.  ' });
    assert.equal(r2.status, 200, r2.text);
    assert.equal(r2.body.tip.text, 'Short tip.');
    assert.deepEqual(r2.body.change.payload as TipPayload, { card_id: 'OGN-251', text: 'Short tip.', prev_text: text });

    const s = await state();
    assert.deepEqual(
      s.tips.map((t) => [t.card_id, t.text, t.source]),
      [['OGN-251', 'Short tip.', 'user']],
    );
    const feed = await api.get<{ changes: Change[] }>('/api/changes?kind=tip');
    assert.equal(feed.body.changes.length, 2);
    assert.ok(feed.body.changes.every((c) => c.kind === 'tip'));

    // validation
    const empty = await api.put<ApiError>('/api/tips/OGN-251', { op_id: randomUUID(), text: '   ' });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, 'VALIDATION');
    const long = await api.put<ApiError>('/api/tips/OGN-251', { op_id: randomUUID(), text: 'x'.repeat(401) });
    assert.equal(long.status, 400);
    const wordy = await api.put<ApiError>('/api/tips/OGN-251', { op_id: randomUUID(), text: Array.from({ length: 61 }, (_, i) => `w${i}`).join(' ') });
    assert.equal(wordy.status, 400);
    const unknown = await api.put<ApiError>('/api/tips/OGN-999', { op_id: randomUUID(), text: 'nope' });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'NOT_FOUND');
    assert.equal((await state()).tips.length, 1);
  });

  // ---- alt-art ids: case-normalised, suffix preserved --------------------------------------
  it('alt-art ids survive case normalisation in inventory and tips (ogn-036A → OGN-036a)', async () => {
    const r = await inv({ mode: 'add', items: [{ card_id: 'ogn-036A', finish: 'normal', qty: 1 }] });
    assert.equal(r.status, 200, r.text);
    assert.equal(payload(r.body.change).lines[0].card_id, 'OGN-036a');
    assert.equal(r.body.change?.entity, 'OGN-036a');
    assert.equal(qtyOf(await state(), 'OGN-036a'), 1);
    const undo = await api.post<{ change: Change }>(`/api/changes/${r.body.change!.seq}/undo`, { op_id: randomUUID() });
    assert.equal(undo.status, 200, undo.text);
    assert.equal(qtyOf(await state(), 'OGN-036a'), 0);

    const t = await api.put<{ tip: Tip; change: Change }>('/api/tips/ogn-036a', { op_id: randomUUID(), text: 'Alt art of Vi.' });
    assert.equal(t.status, 200, t.text);
    assert.equal(t.body.tip.card_id, 'OGN-036a');
    assert.equal(t.body.change.entity, 'OGN-036a');
    // tokens / specials (uppercase prefixes) are untouched by the normaliser
    const tok = await inv({ mode: 'add', items: [{ card_id: 'ogn-t01', finish: 'normal', qty: 1 }] });
    assert.equal(tok.status, 400);
    assert.deepEqual(tok.body.error.unknown_ids, ['OGN-T01']);
  });

  // ---- 10. SSE -----------------------------------------------------------------------------
  it('10. SSE: hello carries the current seq; a POST is broadcast as event: change within 1.5 s', async () => {
    const before = await health();
    const sse = await openSse(`${srv.baseUrl}/api/events?device_id=${DEVICE_ID}`);
    let invSeq = 0;
    try {
      const hello = await sse.waitFor((e) => e.event === 'hello', 3000);
      const h = hello.json<{ seq: number; catalog_version: number; instance: string; server_time: string }>();
      assert.equal(h.seq, before.seq);
      assert.equal(h.catalog_version, 1);
      assert.ok(typeof h.instance === 'string' && h.instance.length > 0);
      assert.ok(!Number.isNaN(Date.parse(h.server_time)));

      const presence = await sse.waitFor((e) => e.event === 'presence', 3000);
      const pdev = presence.json<{ devices: { id: string; name: string; tabs: number }[] }>().devices;
      assert.ok(pdev.some((d) => d.id === DEVICE_ID && d.name === 'Tester' && d.tabs >= 1), JSON.stringify(pdev));
      assert.ok((await health()).clients >= 1);

      const t0 = Date.now();
      const post = await add('OGN-013', 1);
      assert.equal(post.status, 200, post.text);
      const seq = post.body.change!.seq;
      invSeq = seq;
      const ev = await sse.waitFor((e) => e.event === 'change' && e.json<Change>().seq === seq, 1500);
      assert.ok(ev.at - t0 <= 1500, `change event took ${ev.at - t0} ms`);
      assert.equal(ev.id, String(seq));
      const c = ev.json<Change>();
      assert.equal(c.kind, 'inventory');
      assert.equal(c.undone, false);
      assert.equal(c.device?.id, DEVICE_ID);
      assert.deepEqual(
        (c.payload as InventoryPayload).lines.map((l) => [l.card_id, l.prev_qty, l.qty]),
        [['OGN-013', 0, 1]],
      );
      // a replay must not be re-broadcast
      const replay = await api.post<InventoryResponse>('/api/inventory', { op_id: post.body.change!.op_id, reason: 'manual', mode: 'add', items: [{ card_id: 'OGN-013', finish: 'normal', qty: 1 }] });
      assert.equal(replay.body.replayed, true);
      const tip = await api.put<{ change: Change }>('/api/tips/OGN-013', { op_id: randomUUID(), text: 'Pouts.' });
      const tipEv = await sse.waitFor((e) => e.event === 'change' && e.json<Change>().seq === tip.body.change.seq, 1500);
      assert.equal(tipEv.json<Change>().kind, 'tip');
      const changeEvents = sse.events.filter((e) => e.event === 'change');
      assert.deepEqual(
        changeEvents.map((e) => e.json<Change>().seq),
        [seq, tip.body.change.seq],
      );
    } finally {
      sse.close();
    }
    // a tip change cannot be undone; the inventory change can (keeps the export test deterministic)
    const tipFeed = await api.get<{ changes: Change[] }>('/api/changes?card_id=OGN-013&limit=1');
    assert.equal(tipFeed.body.changes[0].kind, 'tip');
    const notUndoable = await api.post<ApiError>(`/api/changes/${tipFeed.body.changes[0].seq}/undo`, { op_id: randomUUID() });
    assert.equal(notUndoable.status, 409);
    assert.equal(notUndoable.body.error.code, 'NOT_UNDOABLE');
    const undo = await api.post<{ change: Change }>(`/api/changes/${invSeq}/undo`, { op_id: randomUUID() });
    assert.equal(undo.status, 200, undo.text);
    assert.equal(qtyOf(await state(), 'OGN-013'), 0);
  });

  // ---- 11. catalog / ETag ------------------------------------------------------------------
  it('11. GET /api/catalog returns the seeded catalog with an ETag; If-None-Match → 304', async () => {
    const r = await api.get<Catalog>('/api/catalog');
    assert.equal(r.status, 200, r.text);
    const etag = r.headers.get('etag');
    assert.equal(etag, '"1"');
    assert.equal(r.body.catalog_version, 1);
    assert.deepEqual(
      r.body.sets.map((s) => s.code),
      ['OGN'],
    );
    assert.equal(r.body.cards.length, SEED_CARDS.length);
    const alt = r.body.cards.find((c) => c.id === 'OGN-036a');
    assert.equal(alt?.variant_of, 'OGN-036');
    assert.deepEqual(alt?.domains, ['fury']);
    assert.equal(r.body.cards.find((c) => c.id === 'OGN-007')?.type, 'Rune');
    const prod = r.body.products.find((p) => p.id === PRODUCT);
    assert.ok(prod);
    assert.equal(prod.contents.length, SEED_PRODUCT.contents.length);
    assert.equal(prod.contents.reduce((a, c) => a + c.qty, 0), SEED_PRODUCT_COPIES);
    assert.ok(r.body.products.some((p) => p.id === SEED_BOOSTER.id && p.fixed_contents === 0));
    assert.deepEqual(r.body.decks, []);

    const nm = await api.get('/api/catalog', { 'If-None-Match': etag! });
    assert.equal(nm.status, 304);
    assert.equal(nm.text, '');
    assert.equal(nm.headers.get('etag'), etag);
    const stale = await api.get<Catalog>('/api/catalog', { 'If-None-Match': '"0"' });
    assert.equal(stale.status, 200);
  });

  // ---- 12. CSV export ----------------------------------------------------------------------
  it('12. GET /api/export.csv has a BOM, the fixed header, CRLF rows and matches the inventory', async () => {
    // read raw bytes: Response.text() would silently strip the BOM we want to assert on
    const res = await fetch(`${srv.baseUrl}/api/export.csv`, { headers: { 'X-Device-Id': DEVICE_ID } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/csv/);
    assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="riftbound-inventory-\d{8}-\d{4}\.csv"/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a UTF-8 BOM');
    const text = bytes.toString('utf8');
    assert.equal(text.charCodeAt(0), 0xfeff);
    const firstLine = text.slice(1).split('\r\n')[0];
    assert.equal(firstLine, 'card_id,set_code,number,name,finish,qty,note');
    assert.equal(firstLine, CSV_HEADER.join(','));
    assert.ok(text.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(text), 'all line endings are CRLF');

    const rows = parseCsv(text);
    assert.deepEqual(rows[0], [...CSV_HEADER]);
    const s = await state();
    const owned = s.inventory.filter((x) => x.qty > 0);
    assert.equal(rows.length - 1, owned.length);
    const byKey = new Map(rows.slice(1).map((x) => [`${x[0]}:${x[4]}`, x]));
    for (const o of owned) {
      const row = byKey.get(`${o.card_id}:${o.finish}`);
      assert.ok(row, `missing export row for ${o.card_id} ${o.finish}`);
      assert.equal(Number(row[5]), o.qty);
      assert.equal(row[6], o.note);
      const card = SEED_CARDS.find((c) => c.id === o.card_id)!;
      assert.equal(row[1], 'OGN');
      assert.equal(row[2], card.number);
      assert.equal(row[3], card.name);
    }
    const jinx = byKey.get('OGN-001:normal');
    assert.deepEqual(jinx, ['OGN-001', 'OGN', '001', 'Blazing Scorcher', 'normal', '50', '']);
    assert.deepEqual(byKey.get('OGN-003:foil'), ['OGN-003', 'OGN', '003', 'Chemtech Enforcer', 'foil', '4', 'traded']);
    assert.equal(byKey.has('OGN-002:foil'), false, 'qty 0 rows are excluded by default');

    const zero = await api.get<string>('/api/export.csv?include_zero=1');
    const zrows = parseCsv(zero.text);
    const wish = zrows.find((x) => x[0] === 'OGN-002' && x[4] === 'foil');
    assert.deepEqual(wish, ['OGN-002', 'OGN', '002', 'Brazen Buccaneer', 'foil', '0', 'wishlist']);
    assert.equal(zrows.length - 1, s.inventory.filter((x) => x.qty > 0 || x.note !== '').length);
  });

  // ---- settings ----------------------------------------------------------------------------
  it('PUT /api/settings clamps values and records a settings change', async () => {
    const r = await api.put<{ settings: State['settings'] }>('/api/settings', { op_id: randomUUID(), playset_size: 4, rune_playset_size: 999, collection_name: '  Our Binder  ' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.settings.playset_size, 4);
    assert.equal(r.body.settings.rune_playset_size, 99);
    assert.equal(r.body.settings.collection_name, 'Our Binder');
    const s = await state();
    assert.equal(s.settings.playset_size, 4);
    const feed = await api.get<{ changes: Change[] }>('/api/changes?kind=settings');
    assert.equal(feed.body.changes.length, 1);
    // playset change is reflected in previews
    const p = await preview();
    assert.equal(p.summary.severity, 'green');
    await api.put('/api/settings', { op_id: randomUUID(), playset_size: 3, rune_playset_size: 12, collection_name: 'Riftbound Inventory' });
  });
});
