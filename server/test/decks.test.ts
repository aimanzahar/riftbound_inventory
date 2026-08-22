// End-to-end tests for user-authored decks against a freshly spawned server.
// Subtests run sequentially and build on each other's deck state.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeClient, openSse, startServer, type ApiClient, type TestServer } from './helpers.ts';
import type { ApiError, Change, State, UserDeck, UserDeckPayload, UserDeckResponse } from '../../shared/types.ts';

type DeckRes = UserDeckResponse & ApiError;

describe('api decks', { timeout: 120_000 }, () => {
  let srv: TestServer;
  let api: ApiClient;
  let deckId = '';

  before(async () => {
    srv = await startServer();
    api = makeClient(srv.baseUrl);
  });
  after(async () => {
    await srv?.stop();
  });

  const state = async (): Promise<State> => (await api.get<State>('/api/state')).body;
  const decksOf = async (): Promise<UserDeck[]> => (await api.get<{ decks: UserDeck[] }>('/api/decks')).body.decks;
  const getDeck = async (id: string): Promise<UserDeck | undefined> => (await decksOf()).find((d) => d.id === id);
  const cards = (body: Record<string, unknown>, id = deckId) => api.post<DeckRes>(`/api/decks/${id}/cards`, { op_id: randomUUID(), ...body });
  const addCard = (card_id: string, section: string, qty: number) => cards({ mode: 'add', items: [{ card_id, section, qty }] });
  const qtyOf = (d: UserDeck | undefined, card_id: string, section: string) => d?.cards.find((c) => c.card_id === card_id && c.section === section)?.qty ?? 0;
  const payloadOf = (c: Change | undefined): UserDeckPayload => {
    assert.ok(c, 'expected a change');
    return c.payload as UserDeckPayload;
  };

  // ---- 1. create ---------------------------------------------------------------------------
  it('starts empty, then creates a deck and records a deck change', async () => {
    assert.deepEqual(await decksOf(), []);
    assert.deepEqual((await state()).user_decks, []);

    const res = await api.post<DeckRes>('/api/decks', { op_id: randomUUID(), name: '  Jinx Aggro  ', color: '#f97316' });
    assert.equal(res.status, 200, res.text);
    const deck = res.body.deck!;
    deckId = deck.id;
    assert.equal(deck.name, 'Jinx Aggro', 'name is trimmed');
    assert.equal(deck.color, '#f97316');
    assert.equal(deck.archived, 0);
    assert.deepEqual(deck.cards, []);

    const change = res.body.change!;
    assert.equal(change.kind, 'deck');
    assert.equal(change.reason, 'create');
    assert.equal(change.entity, deck.id);
    assert.equal(payloadOf(change).deck?.id, deck.id);

    assert.equal((await state()).user_decks.length, 1, 'decks ride on /api/state');
  });

  it('rejects a blank name and a malformed colour', async () => {
    const blank = await api.post<ApiError>('/api/decks', { op_id: randomUUID(), name: '   ' });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error.code, 'VALIDATION');

    const color = await api.post<ApiError>('/api/decks', { op_id: randomUUID(), name: 'Bad colour', color: 'orange' });
    assert.equal(color.status, 400);

    const opId = await api.post<ApiError>('/api/decks', { op_id: 'short', name: 'Bad op' });
    assert.equal(opId.status, 400);
  });

  // ---- 2. card lines -----------------------------------------------------------------------
  it('adds cards and reports absolute qty with prev_qty', async () => {
    const res = await addCard('OGN-030', 'main', 3);
    assert.equal(res.status, 200, res.text);
    const p = payloadOf(res.body.change);
    assert.deepEqual(p.lines, [{ card_id: 'OGN-030', section: 'main', qty: 3, prev_qty: 0 }]);
    assert.equal(p.summary.copies_delta, 3);
    assert.equal(qtyOf(res.body.deck!, 'OGN-030', 'main'), 3);

    const again = await addCard('OGN-030', 'main', 1);
    assert.deepEqual(payloadOf(again.body.change).lines, [{ card_id: 'OGN-030', section: 'main', qty: 4, prev_qty: 3 }]);
  });

  it('keeps the same card in different sections apart', async () => {
    await addCard('OGN-030', 'side', 1);
    const d = await getDeck(deckId);
    assert.equal(qtyOf(d, 'OGN-030', 'main'), 4);
    assert.equal(qtyOf(d, 'OGN-030', 'side'), 1);
  });

  it('removes the line when a delta takes it to zero, clamping instead of going negative', async () => {
    const res = await addCard('OGN-030', 'side', -5);
    assert.deepEqual(payloadOf(res.body.change).lines, [{ card_id: 'OGN-030', section: 'side', qty: 0, prev_qty: 1 }]);
    assert.equal(qtyOf(res.body.deck!, 'OGN-030', 'side'), 0);
    assert.equal(res.body.deck!.cards.some((c) => c.section === 'side'), false, 'row deleted, not left at 0');
  });

  it('set mode writes an absolute qty', async () => {
    const res = await cards({ mode: 'set', items: [{ card_id: 'OGN-030', section: 'main', qty: 2 }] });
    assert.deepEqual(payloadOf(res.body.change).lines, [{ card_id: 'OGN-030', section: 'main', qty: 2, prev_qty: 4 }]);
  });

  it('accepts a multi-card write and sums duplicate add items', async () => {
    const res = await cards({
      mode: 'add',
      items: [
        { card_id: 'OGN-251', section: 'legend', qty: 1 },
        { card_id: 'OGN-007', section: 'runes', qty: 6 },
        { card_id: 'OGN-007', section: 'runes', qty: 6 },
      ],
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(qtyOf(res.body.deck!, 'OGN-007', 'runes'), 12, 'duplicate add items are summed');
    assert.equal(qtyOf(res.body.deck!, 'OGN-251', 'legend'), 1);
  });

  it('is a no-op when nothing moves', async () => {
    const res = await cards({ mode: 'set', items: [{ card_id: 'OGN-251', section: 'legend', qty: 1 }] });
    assert.equal(res.body.noop, true);
    assert.equal(res.body.change, undefined);
  });

  it('replays an identical op_id without applying it twice', async () => {
    const op_id = randomUUID();
    const first = await api.post<DeckRes>(`/api/decks/${deckId}/cards`, { op_id, mode: 'add', items: [{ card_id: 'OGN-011', section: 'main', qty: 2 }] });
    assert.equal(qtyOf(first.body.deck!, 'OGN-011', 'main'), 2);

    const replay = await api.post<DeckRes>(`/api/decks/${deckId}/cards`, { op_id, mode: 'add', items: [{ card_id: 'OGN-011', section: 'main', qty: 2 }] });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.change!.seq, first.body.change!.seq);
    assert.equal(qtyOf(await getDeck(deckId), 'OGN-011', 'main'), 2, 'still 2, not 4');
  });

  it('rejects bad sections, unknown cards, out-of-range qty and unknown decks', async () => {
    const champion = await cards({ mode: 'add', items: [{ card_id: 'OGN-030', section: 'champion', qty: 1 }] });
    assert.equal(champion.status, 400, 'champion is not a builder section');

    const bogus = await cards({ mode: 'add', items: [{ card_id: 'OGN-030', section: 'sideboard', qty: 1 }] });
    assert.equal(bogus.status, 400);

    const unknown = await cards({ mode: 'add', items: [{ card_id: 'ZZZ-999', section: 'main', qty: 1 }] });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'VALIDATION');

    const huge = await cards({ mode: 'add', items: [{ card_id: 'OGN-030', section: 'main', qty: 5000 }] });
    assert.equal(huge.status, 400);

    const empty = await cards({ mode: 'add', items: [] });
    assert.equal(empty.status, 400);

    const missing = await cards({ mode: 'add', items: [{ card_id: 'OGN-030', section: 'main', qty: 1 }] }, 'no-such-deck');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });

  it('normalises card id casing the way the catalog stores it', async () => {
    const res = await cards({ mode: 'add', items: [{ card_id: 'ogn-036A', section: 'main', qty: 1 }] });
    assert.equal(res.status, 200, res.text);
    assert.equal(qtyOf(res.body.deck!, 'OGN-036a', 'main'), 1);
  });

  // ---- 3. undo -----------------------------------------------------------------------------
  it('undoes a card change back to its previous quantities', async () => {
    const before = qtyOf(await getDeck(deckId), 'OGN-011', 'main');
    const res = await cards({ mode: 'set', items: [{ card_id: 'OGN-011', section: 'main', qty: 9 }] });
    const seq = res.body.change!.seq;
    assert.equal(qtyOf(await getDeck(deckId), 'OGN-011', 'main'), 9);

    const undo = await api.post<{ change: Change } & ApiError>(`/api/changes/${seq}/undo`, { op_id: randomUUID() });
    assert.equal(undo.status, 200, undo.text);
    assert.equal(undo.body.change.kind, 'deck');
    assert.equal(undo.body.change.undo_of, seq);
    assert.equal(qtyOf(await getDeck(deckId), 'OGN-011', 'main'), before, 'restored to the pre-change qty');

    const twice = await api.post<ApiError>(`/api/changes/${seq}/undo`, { op_id: randomUUID() });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'ALREADY_UNDONE');
  });

  it('refuses to undo a non-card deck change', async () => {
    const res = await api.put<DeckRes>(`/api/decks/${deckId}`, { op_id: randomUUID(), notes: 'undo me' });
    const undo = await api.post<ApiError>(`/api/changes/${res.body.change!.seq}/undo`, { op_id: randomUUID() });
    assert.equal(undo.status, 409);
    assert.equal(undo.body.error.code, 'NOT_UNDOABLE');
  });

  // ---- 4. deck metadata --------------------------------------------------------------------
  it('renames, archives and no-ops an unchanged update', async () => {
    const rename = await api.put<DeckRes>(`/api/decks/${deckId}`, { op_id: randomUUID(), name: 'Jinx Aggro v2' });
    assert.equal(rename.status, 200, rename.text);
    assert.equal(rename.body.deck!.name, 'Jinx Aggro v2');
    assert.equal(rename.body.change!.reason, 'update');

    const noop = await api.put<DeckRes>(`/api/decks/${deckId}`, { op_id: randomUUID(), name: 'Jinx Aggro v2' });
    assert.equal(noop.body.noop, true);

    const archived = await api.put<DeckRes>(`/api/decks/${deckId}`, { op_id: randomUUID(), archived: true });
    assert.equal(archived.body.deck!.archived, 1);
    assert.equal(archived.body.deck!.cards.length > 0, true, 'archiving keeps the cards');

    await api.put<DeckRes>(`/api/decks/${deckId}`, { op_id: randomUUID(), archived: false });
    assert.equal((await getDeck(deckId))!.archived, 0);

    const missing = await api.put<ApiError>('/api/decks/no-such-deck', { op_id: randomUUID(), name: 'x' });
    assert.equal(missing.status, 404);
  });

  // ---- 5. realtime -------------------------------------------------------------------------
  it('broadcasts deck changes over SSE', async () => {
    const sse = await openSse(`${srv.baseUrl}/api/events?device_id=sse-deck-watcher`);
    try {
      await sse.waitFor((e) => e.event === 'hello', 3000);
      const res = await addCard('OGN-013', 'main', 2);
      const seq = res.body.change!.seq;
      const ev = await sse.waitFor((e) => e.event === 'change' && e.json<Change>().seq === seq, 5000);
      const change = ev.json<Change>();
      assert.equal(change.kind, 'deck');
      assert.equal(change.entity, deckId);
      const p = change.payload as UserDeckPayload;
      assert.equal(p.deck?.id, deckId, 'payload carries the full post-state so clients need no refetch');
      assert.equal(p.deck?.cards.some((c) => c.card_id === 'OGN-013'), true);
    } finally {
      sse.close();
    }
  });

  // ---- 6. delete ---------------------------------------------------------------------------
  it('deletes the deck, cascading its cards', async () => {
    const second = await api.post<DeckRes>('/api/decks', { op_id: randomUUID(), name: 'Scratch deck' });
    const scratchId = second.body.deck!.id;
    await addCard('OGN-001', 'main', 1);

    const del = await api.req<DeckRes>('DELETE', `/api/decks/${scratchId}`, { op_id: randomUUID() });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.body.deck, null);
    assert.equal(del.body.change!.reason, 'delete');
    assert.equal(payloadOf(del.body.change).deck, null);

    const remaining = await decksOf();
    assert.equal(remaining.some((d) => d.id === scratchId), false);
    assert.equal(remaining.some((d) => d.id === deckId), true, 'the other deck survives');

    const again = await api.req<ApiError>('DELETE', `/api/decks/${scratchId}`, { op_id: randomUUID() });
    assert.equal(again.status, 404);
  });

  it('leaves no orphaned card rows behind', async () => {
    const decks = await decksOf();
    const ids = new Set(decks.map((d) => d.id));
    for (const d of decks) for (const c of d.cards) assert.ok(ids.has(d.id), `orphan line ${c.card_id}`);
    assert.equal((await state()).user_decks.length, decks.length);
  });
});
