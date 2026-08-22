import type { Db } from '../db/open.ts';
import { all, nowIso, one, run } from '../db/open.ts';
import { HttpError } from '../http/body.ts';
import { isUserSection } from '../../shared/deckRules.ts';
import type {
  Change,
  DeviceRef,
  UserDeck,
  UserDeckCard,
  UserDeckCardsRequest,
  UserDeckCreateRequest,
  UserDeckLine,
  UserDeckPayload,
  UserDeckResponse,
  UserDeckUpdateRequest,
} from '../../shared/types.ts';
import { findByOpId, getChange, insertChange, isUndone } from './changes.ts';
import { normalizeCardId, validateOpId } from './inventory.ts';

export const MAX_DECK_NAME = 60;
export const MAX_DECK_NOTES = 2000;
export const MAX_DECK_LINES = 200;
export const MAX_DECK_QTY = 99;

interface DeckRow {
  id: string;
  name: string;
  notes: string;
  color: string | null;
  archived: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

function rowToDeck(r: DeckRow, cards: UserDeckCard[]): UserDeck {
  return { ...r, archived: Number(r.archived), cards };
}

const DECK_COLS = 'id, name, notes, color, archived, created_at, created_by, updated_at, updated_by';

export function listUserDecks(db: Db): UserDeck[] {
  const rows = all<DeckRow>(db, `SELECT ${DECK_COLS} FROM user_decks ORDER BY archived, updated_at DESC`);
  if (!rows.length) return [];
  const lines = all<UserDeckCard & { deck_id: string }>(db, 'SELECT deck_id, card_id, section, qty FROM user_deck_cards');
  const byDeck = new Map<string, UserDeckCard[]>();
  for (const l of lines) {
    const arr = byDeck.get(l.deck_id);
    const card: UserDeckCard = { card_id: l.card_id, section: l.section, qty: Number(l.qty) };
    if (arr) arr.push(card);
    else byDeck.set(l.deck_id, [card]);
  }
  return rows.map((r) => rowToDeck(r, byDeck.get(r.id) ?? []));
}

export function getUserDeck(db: Db, id: string): UserDeck | undefined {
  const r = one<DeckRow>(db, `SELECT ${DECK_COLS} FROM user_decks WHERE id = ?`, id);
  if (!r) return undefined;
  const cards = all<UserDeckCard>(db, 'SELECT card_id, section, qty FROM user_deck_cards WHERE deck_id = ?', id).map((c) => ({ ...c, qty: Number(c.qty) }));
  return rowToDeck(r, cards);
}

function requireDeck(db: Db, id: string): UserDeck {
  const d = getUserDeck(db, id);
  if (!d) throw new HttpError(404, 'NOT_FOUND', `Deck ${id} not found`);
  return d;
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim().slice(0, MAX_DECK_NAME);
  if (!name) throw new HttpError(400, 'VALIDATION', 'name must be 1-60 characters');
  return name;
}

function cleanColor(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw)) throw new HttpError(400, 'VALIDATION', 'color must be #rrggbb');
  return raw;
}

function payloadFor(deck: UserDeck | null, deck_id: string, name: string, extra: Partial<UserDeckPayload> = {}): UserDeckPayload {
  return { deck_id, name, deck, summary: { cards: 0, copies_delta: 0 }, ...extra };
}

// ---------------------------------------------------------------------------
// deck-level writes
// ---------------------------------------------------------------------------

export function createDeck(db: Db, body: UserDeckCreateRequest, device: DeviceRef | null): UserDeckResponse {
  const op_id = validateOpId(body.op_id);
  const name = cleanName(body.name);
  const notes = String(body.notes ?? '').slice(0, MAX_DECK_NOTES);
  const color = cleanColor(body.color);
  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { replayed: true as const, change: replay, deck: getUserDeck(db, (replay.payload as UserDeckPayload).deck_id) ?? null };
    const id = crypto.randomUUID();
    const ts = nowIso();
    run(db, `INSERT INTO user_decks(id, name, notes, color, archived, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,0,?,?,?,?)`, id, name, notes, color, ts, device?.id ?? null, ts, device?.id ?? null);
    const deck = requireDeck(db, id);
    const change = insertChange(db, { op_id, device, kind: 'deck', reason: 'create', entity: id, payload: payloadFor(deck, id, name) });
    return { deck, change };
  });
}

export function updateDeck(db: Db, id: string, body: UserDeckUpdateRequest, device: DeviceRef | null): UserDeckResponse {
  const op_id = validateOpId(body.op_id);
  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { replayed: true as const, change: replay, deck: getUserDeck(db, id) ?? null };
    const prev = requireDeck(db, id);
    const name = body.name === undefined ? prev.name : cleanName(body.name);
    const notes = body.notes === undefined ? prev.notes : String(body.notes).slice(0, MAX_DECK_NOTES);
    const color = body.color === undefined ? prev.color : cleanColor(body.color);
    const archived = body.archived === undefined ? prev.archived : body.archived ? 1 : 0;
    if (name === prev.name && notes === prev.notes && color === prev.color && archived === prev.archived) return { noop: true as const, deck: prev };
    run(db, 'UPDATE user_decks SET name = ?, notes = ?, color = ?, archived = ?, updated_at = ?, updated_by = ? WHERE id = ?', name, notes, color, archived, nowIso(), device?.id ?? null, id);
    const deck = requireDeck(db, id);
    const change = insertChange(db, { op_id, device, kind: 'deck', reason: 'update', entity: id, payload: payloadFor(deck, id, name) });
    return { deck, change };
  });
}

export function deleteDeck(db: Db, id: string, op_id_raw: string, device: DeviceRef | null): UserDeckResponse {
  const op_id = validateOpId(op_id_raw);
  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { replayed: true as const, change: replay, deck: null };
    const prev = requireDeck(db, id);
    run(db, 'DELETE FROM user_decks WHERE id = ?', id); // user_deck_cards cascades
    const change = insertChange(db, { op_id, device, kind: 'deck', reason: 'delete', entity: id, payload: payloadFor(null, id, prev.name) });
    return { deck: null, change };
  });
}

// ---------------------------------------------------------------------------
// card lines
// ---------------------------------------------------------------------------

function validateLineItems(mode: 'add' | 'set', items: unknown): UserDeckCard[] {
  if (!Array.isArray(items)) throw new HttpError(400, 'VALIDATION', 'items must be an array');
  if (items.length === 0) throw new HttpError(400, 'VALIDATION', 'items must not be empty');
  if (items.length > MAX_DECK_LINES) throw new HttpError(400, 'VALIDATION', `at most ${MAX_DECK_LINES} items per request`);
  const out = new Map<string, UserDeckCard>();
  for (const raw of items as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'VALIDATION', 'item must be an object');
    const card_id = typeof raw.card_id === 'string' ? normalizeCardId(raw.card_id) : '';
    if (!card_id) throw new HttpError(400, 'VALIDATION', 'item.card_id required');
    const section = raw.section ?? 'main';
    if (!isUserSection(section)) throw new HttpError(400, 'VALIDATION', `item.section must be one of legend|battlefield|main|runes|side`, { card_id });
    const qty = Number(raw.qty);
    if (!Number.isInteger(qty)) throw new HttpError(400, 'VALIDATION', 'item.qty must be an integer', { card_id });
    if (mode === 'add' ? Math.abs(qty) > MAX_DECK_QTY : qty < 0 || qty > MAX_DECK_QTY) throw new HttpError(400, 'VALIDATION', `item.qty out of range (max ${MAX_DECK_QTY})`, { card_id });
    const key = `${card_id}|${section}`;
    const prev = out.get(key);
    if (prev) {
      if (mode !== 'add') throw new HttpError(400, 'VALIDATION', `duplicate item for ${card_id} (${section})`, { card_id });
      prev.qty += qty;
    } else out.set(key, { card_id, section, qty });
  }
  return [...out.values()];
}

function ensureCardsExist(db: Db, ids: string[]): void {
  const uniq = [...new Set(ids)];
  const unknown: string[] = [];
  for (let i = 0; i < uniq.length; i += 500) {
    const chunk = uniq.slice(i, i + 500);
    const found = new Set(all<{ id: string }>(db, `SELECT id FROM cards WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk).map((r) => r.id));
    for (const id of chunk) if (!found.has(id)) unknown.push(id);
  }
  if (unknown.length) throw new HttpError(400, 'VALIDATION', `Unknown card ids: ${unknown.slice(0, 10).join(', ')}${unknown.length > 10 ? '…' : ''}`, { unknown_ids: unknown });
}

export interface ApplyDeckCardsArgs extends UserDeckCardsRequest {
  device: DeviceRef | null;
  undo_of?: number | null;
}

/** THE single write path for deck lines. Runs in its own tx; idempotent by op_id. */
export function applyDeckCards(db: Db, deckId: string, a: ApplyDeckCardsArgs): UserDeckResponse {
  const op_id = validateOpId(a.op_id);
  if (a.mode !== 'add' && a.mode !== 'set') throw new HttpError(400, 'VALIDATION', 'mode must be add|set');
  const items = validateLineItems(a.mode, a.items);

  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { replayed: true as const, change: replay, deck: getUserDeck(db, deckId) ?? null };
    requireDeck(db, deckId);
    ensureCardsExist(
      db,
      items.map((i) => i.card_id),
    );

    const lines: UserDeckLine[] = [];
    let copiesDelta = 0;
    for (const it of items) {
      const cur = Number(one<{ qty: number }>(db, 'SELECT qty FROM user_deck_cards WHERE deck_id = ? AND card_id = ? AND section = ?', deckId, it.card_id, it.section)?.qty ?? 0);
      const next = Math.max(0, Math.min(MAX_DECK_QTY, a.mode === 'add' ? cur + it.qty : it.qty));
      if (next === cur) continue;
      if (next === 0) run(db, 'DELETE FROM user_deck_cards WHERE deck_id = ? AND card_id = ? AND section = ?', deckId, it.card_id, it.section);
      else
        run(
          db,
          `INSERT INTO user_deck_cards(deck_id, card_id, section, qty) VALUES (?,?,?,?)
           ON CONFLICT(deck_id, card_id, section) DO UPDATE SET qty = excluded.qty`,
          deckId,
          it.card_id,
          it.section,
          next,
        );
      lines.push({ card_id: it.card_id, section: it.section, qty: next, prev_qty: cur });
      copiesDelta += next - cur;
    }

    if (!lines.length && !a.undo_of) return { noop: true as const, deck: getUserDeck(db, deckId) ?? null };

    run(db, 'UPDATE user_decks SET updated_at = ?, updated_by = ? WHERE id = ?', nowIso(), a.device?.id ?? null, deckId);
    const deck = requireDeck(db, deckId);
    const change = insertChange(db, {
      op_id,
      device: a.device,
      kind: 'deck',
      reason: 'cards',
      entity: deckId,
      undo_of: a.undo_of ?? null,
      payload: payloadFor(deck, deckId, deck.name, { lines, summary: { cards: lines.length, copies_delta: copiesDelta } }),
    });
    return { deck, change };
  });
}

/**
 * Undo a `deck` change by replaying every line back to its prev_qty.
 * Lives here rather than in inventory.ts's undoChange so decks.ts stays a leaf of that import edge.
 */
export function undoDeckChange(db: Db, seq: number, op_id_raw: string, device: DeviceRef | null): { change: Change } {
  const op_id = validateOpId(op_id_raw);
  return db.tx(() => {
    const replay = findByOpId(db, op_id);
    if (replay) return { change: replay };
    const target = getChange(db, seq);
    if (!target) throw new HttpError(404, 'NOT_FOUND', `Change ${seq} not found`);
    if (target.kind !== 'deck') throw new HttpError(409, 'NOT_UNDOABLE', 'Not a deck change');
    if (isUndone(db, seq)) throw new HttpError(409, 'ALREADY_UNDONE', `Change ${seq} was already undone`);
    const p = target.payload as UserDeckPayload;
    if (target.reason !== 'cards' || !p.lines?.length) throw new HttpError(409, 'NOT_UNDOABLE', 'Only deck card changes can be undone');
    if (!getUserDeck(db, p.deck_id)) throw new HttpError(409, 'NOT_UNDOABLE', 'That deck no longer exists');
    const res = applyDeckCards(db, p.deck_id, {
      op_id,
      mode: 'set',
      items: p.lines.map((l) => ({ card_id: l.card_id, section: l.section, qty: l.prev_qty })),
      device,
      undo_of: seq,
    });
    if (!res.change) throw new HttpError(500, 'INTERNAL', 'Undo produced no change');
    return { change: res.change };
  });
}
