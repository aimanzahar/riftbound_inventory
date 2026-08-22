import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EXPORT_QTY, planMetaExport, sideCopiesOf, userSectionFor, type MetaExportArgs } from '../../shared/metaExport.ts';
import type { DeckCard, DeckSection, DeckUnresolved } from '../../shared/types.ts';

const line = (card_id: string, section: DeckSection, qty: number): DeckCard => ({ card_id, section, qty });

/** Every id the fixtures use, minus the deliberately-missing 'GONE'. */
const KNOWN = new Set(['L1', 'CH1', 'BF1', 'BF2', 'BF3', 'R1', 'R2', 'S1', ...Array.from({ length: 20 }, (_, i) => `U${i}`)]);

function plan(lines: DeckCard[], opts: Partial<MetaExportArgs> = {}) {
  return planMetaExport({ lines, unresolved: [], knownCardIds: KNOWN, includeSide: true, ...opts });
}

const qtyOf = (p: ReturnType<typeof plan>, card_id: string, section: DeckSection) =>
  p.items.find((i) => i.card_id === card_id && i.section === section)?.qty ?? 0;

/** A realistic tournament list: 1 legend + 1 champion + 39 main + 3 battlefields + 12 runes = 56. */
function metaList(): DeckCard[] {
  return [
    line('L1', 'legend', 1),
    line('CH1', 'champion', 1),
    line('BF1', 'battlefield', 1),
    line('BF2', 'battlefield', 1),
    line('BF3', 'battlefield', 1),
    line('R1', 'runes', 9),
    line('R2', 'runes', 3),
    ...Array.from({ length: 13 }, (_, i) => line(`U${i}`, 'main', 3)),
  ];
}

describe('shared/metaExport userSectionFor', () => {
  it('folds champion into main and passes the other user sections through', () => {
    assert.equal(userSectionFor('champion'), 'main');
    for (const s of ['legend', 'battlefield', 'main', 'runes', 'side'] as DeckSection[]) assert.equal(userSectionFor(s), s);
  });
});

describe('shared/metaExport planMetaExport', () => {
  it('turns a 56-card meta list into 56 writable copies', () => {
    const p = plan(metaList());
    assert.equal(p.copies, 56);
    assert.equal(p.sideCopies, 0);
    assert.equal(p.skipped.length, 0);
  });

  it('lands the champion in main, hitting the 40-card target', () => {
    const p = plan(metaList());
    assert.equal(qtyOf(p, 'CH1', 'main'), 1);
    assert.equal(p.items.filter((i) => i.section === 'champion').length, 0);
    const main = p.items.filter((i) => i.section === 'main').reduce((n, i) => n + i.qty, 0);
    assert.equal(main, 40);
  });

  it('sums a champion into an existing main line instead of emitting a duplicate key', () => {
    const p = plan([line('U0', 'champion', 1), line('U0', 'main', 2)]);
    assert.equal(p.items.length, 1);
    assert.equal(qtyOf(p, 'U0', 'main'), 3);
  });

  it('never emits duplicate (card_id, section) keys', () => {
    const p = plan([...metaList(), line('CH1', 'main', 2), line('R1', 'runes', 1)]);
    const keys = p.items.map((i) => `${i.card_id}|${i.section}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('keeps a legend line that deckLines() injected', () => {
    const p = plan(metaList());
    assert.equal(qtyOf(p, 'L1', 'legend'), 1);
  });

  it('counts the sideboard separately from the 56', () => {
    const p = plan([...metaList(), line('S1', 'side', 2)]);
    assert.equal(p.copies, 56);
    assert.equal(p.sideCopies, 2);
  });

  it('drops side lines and side unresolved when includeSide is false', () => {
    const unresolved: DeckUnresolved[] = [
      { name: 'Mystery Sideboard Card', qty: 2, section: 'side' },
      { name: 'Mystery Main Card', qty: 1, section: 'main' },
    ];
    const p = plan([...metaList(), line('S1', 'side', 2)], { includeSide: false, unresolved });
    assert.equal(p.sideCopies, 0);
    assert.equal(p.items.filter((i) => i.section === 'side').length, 0);
    assert.deepEqual(p.skipped, [{ label: 'Mystery Main Card', qty: 1 }]);
  });

  it('reports card ids missing from the catalog as skipped', () => {
    const p = plan([...metaList(), line('GONE', 'main', 3)]);
    assert.deepEqual(p.skipped, [{ label: 'GONE', qty: 3 }]);
    assert.equal(p.copies, 56);
  });

  it('reports unresolved lines, labelled by name then code', () => {
    const unresolved: DeckUnresolved[] = [
      { name: 'Some Card', qty: 2, section: 'main' },
      { code: 'OGN-999', qty: 1, section: 'main' },
      { qty: 1, section: 'main' },
    ];
    const p = plan(metaList(), { unresolved });
    assert.deepEqual(p.skipped, [
      { label: 'Some Card', qty: 2 },
      { label: 'OGN-999', qty: 1 },
      { label: 'Unknown card', qty: 1 },
    ]);
  });

  it('ignores non-positive quantities', () => {
    const p = plan([line('U0', 'main', 0), line('U1', 'main', -2)], { unresolved: [{ name: 'x', qty: 0, section: 'main' }] });
    assert.deepEqual(p.items, []);
    assert.deepEqual(p.skipped, []);
  });

  it('clamps a merged line to the per-line maximum the API accepts', () => {
    const p = plan([line('U0', 'main', 60), line('U0', 'champion', 60)]);
    assert.equal(qtyOf(p, 'U0', 'main'), MAX_EXPORT_QTY);
  });
});

describe('shared/metaExport sideCopiesOf', () => {
  it('counts only positive sideboard copies', () => {
    assert.equal(sideCopiesOf([line('S1', 'side', 2), line('S1', 'main', 3), line('S1', 'side', -1)]), 2);
  });
});
