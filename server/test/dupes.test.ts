import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePurchase, canonicalId, type AnalyzeArgs } from '../../shared/dupes.ts';
import type { ProductContent } from '../../shared/types.ts';

type MiniCard = { id: string; variant_of: string | null; type: string | null; name: string };
const CARDS = new Map<string, MiniCard>(
  (
    [
      ['OGN-001', null, 'Unit', 'Blazing Scorcher'],
      ['OGN-002', null, 'Unit', 'Brazen Buccaneer'],
      ['OGN-007', null, 'Rune', 'Fury Rune'],
      ['OGN-036', null, 'Unit', 'Vi, Destructive'],
      ['OGN-036a', 'OGN-036', 'Unit', 'Vi, Destructive'],
    ] as const
  ).map(([id, variant_of, type, name]) => [id, { id, variant_of, type, name }]),
);

const c = (card_id: string, qty: number, finish: ProductContent['finish'] = 'normal'): ProductContent => ({ card_id, finish, qty });
const DECK: ProductContent[] = [c('OGN-001', 3), c('OGN-002', 1)];

function analyze(contents: ProductContent[], owned: Record<string, number> = {}, extra: Partial<AnalyzeArgs> = {}) {
  return analyzePurchase({
    product: { id: 'p-test', name: 'Test Deck', kind: 'champion_deck', contents },
    qty: 1,
    ownedByCanonical: new Map(Object.entries(owned)),
    cardsById: CARDS,
    priceByCard: new Map(),
    playset: 3,
    runePlayset: 12,
    timesBought: 0,
    lastBought: null,
    ...extra,
  });
}
const line = (r: ReturnType<typeof analyze>, id: string) => {
  const l = r.lines.find((x) => x.card_id === id);
  assert.ok(l, `no line for ${id}`);
  return l;
};

describe('shared/dupes canonicalId', () => {
  it('collapses variants onto the base printing', () => {
    assert.equal(canonicalId(CARDS.get('OGN-036a'), 'OGN-036a'), 'OGN-036');
    assert.equal(canonicalId(CARDS.get('OGN-036'), 'OGN-036'), 'OGN-036');
    assert.equal(canonicalId(undefined, 'XXX-001'), 'XXX-001');
  });
});

describe('shared/dupes analyzePurchase severity', () => {
  it('green: nothing owned, everything new', () => {
    const r = analyze(DECK);
    assert.equal(r.summary.severity, 'green');
    assert.equal(r.summary.distinct, 2);
    assert.equal(r.summary.copies, 4);
    assert.equal(r.summary.new_copies, 4);
    assert.equal(r.summary.dup_copies, 0);
    assert.equal(r.summary.beyond_playset_copies, 0);
    assert.equal(r.summary.new_distinct, 2);
    assert.equal(r.summary.partial_distinct, 0);
    assert.equal(r.summary.owned_distinct, 0);
    assert.equal(r.summary.est_value_usd, 0);
    assert.equal(r.summary.priced_lines, 0);
    assert.equal(r.times_bought, 0);
    assert.equal(r.last_bought, null);
    assert.ok(r.lines.every((l) => l.status === 'new' && l.owned_now === 0 && l.dup_copies === 0));
    assert.equal(r.summary.headline, 'All 4 cards are new to your collection.');
    assert.deepEqual(r.product, { id: 'p-test', name: 'Test Deck', kind: 'champion_deck' });
    assert.equal(r.qty, 1);
  });

  it('amber: some copies already owned (partial line, duplicates, beyond playset)', () => {
    const r = analyze(DECK, { 'OGN-001': 1 });
    assert.equal(r.summary.severity, 'amber');
    const l1 = line(r, 'OGN-001');
    assert.equal(l1.status, 'partial');
    assert.equal(l1.owned_now, 1);
    assert.equal(l1.owned_after, 4);
    assert.equal(l1.dup_copies, 1);
    assert.equal(l1.beyond_playset, 1); // 4 after vs playset 3, none were beyond before
    assert.equal(line(r, 'OGN-002').status, 'new');
    assert.equal(r.summary.new_copies, 3);
    assert.equal(r.summary.dup_copies, 1);
    assert.equal(r.summary.beyond_playset_copies, 1);
    assert.equal(r.summary.partial_distinct, 1);
    assert.equal(r.summary.new_distinct, 1);
    assert.match(r.summary.headline, /^1 of 2 cards are already in your collection/);
    assert.match(r.summary.headline, /3 new and 1 duplicate copy/);
    assert.match(r.summary.headline, /1 beyond a playset of 3/);
    // owned/partial lines sort before new ones
    assert.deepEqual(
      r.lines.map((l) => l.status),
      ['partial', 'new'],
    );
  });

  it('red: every card already owned (no new copies)', () => {
    const r = analyze(DECK, { 'OGN-001': 3, 'OGN-002': 1 });
    assert.equal(r.summary.severity, 'red');
    assert.ok(r.lines.every((l) => l.status === 'owned'));
    assert.equal(r.summary.new_copies, 0);
    assert.equal(r.summary.dup_copies, 4);
    assert.equal(r.summary.owned_distinct, 2);
    assert.equal(r.summary.beyond_playset_copies, 3); // OGN-001: 6 after − 3 playset, minus 0 already beyond
    assert.equal(r.summary.headline, 'You already own every card in this product. Buying it adds 4 duplicates.');
  });

  it('red: times_bought > 0 is red even when every copy would be new', () => {
    const last = { ts: '2026-08-01T10:00:00.000Z', device_name: 'PC' };
    const r = analyze(DECK, {}, { timesBought: 1, lastBought: last });
    assert.equal(r.summary.severity, 'red');
    assert.equal(r.summary.new_copies, 4);
    assert.equal(r.summary.dup_copies, 0);
    assert.equal(r.times_bought, 1);
    assert.deepEqual(r.last_bought, last);
    assert.match(r.summary.headline, /^You already bought this ×1 \(.*PC\)\. Buying again adds 4 new cards and 0 duplicates\.$/);
    // and stays red when partially owned, with the counts reflecting the inventory
    const r2 = analyze(DECK, { 'OGN-001': 1 }, { timesBought: 2, lastBought: null });
    assert.equal(r2.summary.severity, 'red');
    assert.match(r2.summary.headline, /^You already bought this ×2\. Buying again adds 3 new cards and 1 duplicate\.$/);
  });

  it('amber vs green hinges on dup_copies, not on beyond_playset', () => {
    // 4 copies of a card you own none of: all new (green) although one copy is beyond a playset of 3
    const r = analyze([c('OGN-001', 4)]);
    assert.equal(r.summary.severity, 'green');
    assert.equal(r.summary.beyond_playset_copies, 1);
  });
});

describe('shared/dupes analyzePurchase beyond_playset math', () => {
  it('playset 3: only copies that cross the threshold count, and only once', () => {
    assert.equal(line(analyze([c('OGN-001', 3)], { 'OGN-001': 2 }), 'OGN-001').beyond_playset, 2); // 2 → 5: copies 4,5
    assert.equal(line(analyze([c('OGN-001', 3)], { 'OGN-001': 5 }), 'OGN-001').beyond_playset, 3); // already beyond: all 3 new copies are beyond
    assert.equal(line(analyze([c('OGN-001', 2)]), 'OGN-001').beyond_playset, 0); // 0 → 2
    assert.equal(line(analyze([c('OGN-001', 1)], { 'OGN-001': 2 }), 'OGN-001').beyond_playset, 0); // 2 → 3 exactly a playset
    assert.equal(line(analyze([c('OGN-001', 1)], { 'OGN-001': 3 }), 'OGN-001').beyond_playset, 1); // 3 → 4
  });

  it('respects a custom playset size', () => {
    assert.equal(line(analyze([c('OGN-001', 3)], { 'OGN-001': 2 }, { playset: 4 }), 'OGN-001').beyond_playset, 1); // 2 → 5 vs 4
    assert.equal(line(analyze([c('OGN-001', 3)], { 'OGN-001': 2 }, { playset: 1 }), 'OGN-001').beyond_playset, 3);
  });

  it('runes use the rune playset (12), not the card playset', () => {
    // 6 runes on top of 10 owned: 16 after → 4 beyond 12 (a Unit with the same numbers would be 6 beyond 3)
    assert.equal(line(analyze([c('OGN-007', 6)], { 'OGN-007': 10 }), 'OGN-007').beyond_playset, 4);
    assert.equal(line(analyze([c('OGN-001', 6)], { 'OGN-001': 10 }), 'OGN-001').beyond_playset, 6);
    // a fresh deck's 12 runes are within the rune playset
    const r = analyze([c('OGN-007', 12)]);
    assert.equal(line(r, 'OGN-007').beyond_playset, 0);
    assert.equal(r.summary.severity, 'green');
    // custom rune playset
    assert.equal(line(analyze([c('OGN-007', 12)], {}, { runePlayset: 6 }), 'OGN-007').beyond_playset, 6);
  });
});

describe('shared/dupes analyzePurchase canonical merging', () => {
  it('merges two printings of the same card into one line keyed by the first printing', () => {
    const r = analyze([c('OGN-036', 1), c('OGN-036a', 1)]);
    assert.equal(r.lines.length, 1);
    assert.equal(r.summary.distinct, 1);
    assert.equal(r.summary.copies, 2);
    const l = r.lines[0];
    assert.equal(l.card_id, 'OGN-036');
    assert.equal(l.finish, 'normal');
    assert.equal(l.in_product, 2);
    assert.equal(l.status, 'new');
    assert.equal(r.summary.headline, 'All 2 cards are new to your collection.');
  });

  it('owned copies of the base printing count against an alt-art line (and vice versa)', () => {
    const r = analyze([c('OGN-036a', 1, 'foil')], { 'OGN-036': 2 });
    const l = line(r, 'OGN-036a');
    assert.equal(l.finish, 'foil');
    assert.equal(l.owned_now, 2);
    assert.equal(l.owned_after, 3);
    assert.equal(l.status, 'owned');
    assert.equal(l.dup_copies, 1);
    assert.equal(r.summary.severity, 'red');

    const r2 = analyze([c('OGN-036', 1), c('OGN-036a', 1)], { 'OGN-036': 1 });
    const l2 = line(r2, 'OGN-036');
    assert.equal(l2.status, 'partial');
    assert.equal(l2.dup_copies, 1);
    assert.equal(l2.owned_after, 3);
    assert.equal(l2.beyond_playset, 0);
    assert.equal(r2.summary.severity, 'amber');
  });

  it('cards missing from cardsById fall back to their own id as canonical', () => {
    const r = analyze([c('XXX-001', 2)], { 'XXX-001': 1 });
    const l = line(r, 'XXX-001');
    assert.equal(l.status, 'partial');
    assert.equal(l.owned_now, 1);
    assert.equal(l.dup_copies, 1);
  });
});

describe('shared/dupes analyzePurchase qty / prices / edge cases', () => {
  it('multiplies contents by qty (floored, min 1)', () => {
    const r = analyze(DECK, {}, { qty: 2 });
    assert.equal(r.qty, 2);
    assert.equal(r.summary.copies, 8);
    assert.equal(line(r, 'OGN-001').in_product, 6);
    assert.equal(analyze(DECK, {}, { qty: 0 }).qty, 1);
    assert.equal(analyze(DECK, {}, { qty: 2.7 }).qty, 2);
    assert.equal(analyze(DECK, {}, { qty: Number.NaN }).qty, 1);
  });

  it('sums market prices per copy and falls back to the canonical printing price', () => {
    const prices = new Map([
      ['OGN-001', 1.5],
      ['OGN-036', 10],
    ]);
    const r = analyze(DECK, {}, { priceByCard: prices });
    assert.equal(r.summary.est_value_usd, 4.5); // 3 × 1.5; OGN-002 unpriced
    assert.equal(r.summary.priced_lines, 1);
    const r2 = analyze([c('OGN-036a', 2)], {}, { priceByCard: prices });
    assert.equal(r2.summary.est_value_usd, 20);
    assert.equal(r2.summary.priced_lines, 1);
    const r3 = analyze([c('OGN-001', 3)], {}, { priceByCard: new Map([['OGN-001', 0.333]]) });
    assert.equal(r3.summary.est_value_usd, 1); // rounded to cents
  });

  it('empty contents → no lines, green, explanatory headline', () => {
    const r = analyze([], { 'OGN-001': 99 }, { timesBought: 0 });
    assert.equal(r.lines.length, 0);
    assert.equal(r.summary.distinct, 0);
    assert.equal(r.summary.severity, 'green');
    assert.equal(r.summary.headline, 'This product has no fixed card list.');
  });

  it('lines are ordered owned → partial → new, then by card id', () => {
    const r = analyze([c('OGN-002', 1), c('OGN-001', 1), c('OGN-036', 1), c('OGN-007', 1)], { 'OGN-001': 5, 'OGN-007': 1, 'OGN-036': 1 });
    assert.deepEqual(
      r.lines.map((l) => [l.card_id, l.status]),
      [
        ['OGN-001', 'owned'],
        ['OGN-007', 'owned'],
        ['OGN-036', 'owned'],
        ['OGN-002', 'new'],
      ],
    );
  });
});
