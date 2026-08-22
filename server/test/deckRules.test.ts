import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DECK_TARGETS, USER_SECTIONS, isUserSection, sectionForCard, validateDeck, type DeckCardInfo } from '../../shared/deckRules.ts';
import type { DeckSection, UserDeckCard } from '../../shared/types.ts';

function card(id: string, type: string, extra: Partial<DeckCardInfo> = {}): DeckCardInfo {
  return { id, name: id, type, variant_of: null, banned: 0, ...extra };
}

/** Catalog covering everything the fixtures below reference. */
function catalog(extra: DeckCardInfo[] = []): Map<string, DeckCardInfo> {
  const cards: DeckCardInfo[] = [
    card('L1', 'Legend'),
    card('BF1', 'Battlefield'),
    card('R1', 'Rune'),
    card('V1', 'Unit'),
    card('V1a', 'Unit', { variant_of: 'V1' }),
    card('BAN', 'Unit', { banned: 1 }),
    ...Array.from({ length: 20 }, (_, i) => card(`U${i}`, 'Unit')),
    ...extra,
  ];
  return new Map(cards.map((c) => [c.id, c]));
}

const line = (card_id: string, section: DeckSection, qty: number): UserDeckCard => ({ card_id, section, qty });

/** 1 Legend + 3 battlefields + 40 main (20 distinct x2) + 12 runes = a legal 56. */
function legalDeck(): UserDeckCard[] {
  return [
    line('L1', 'legend', 1),
    line('BF1', 'battlefield', 3),
    line('R1', 'runes', 12),
    ...Array.from({ length: 20 }, (_, i) => line(`U${i}`, 'main', 2)),
  ];
}

const run = (cards: UserDeckCard[], playset = 3, runePlayset = 12) => validateDeck({ cards, cardsById: catalog(), playset, runePlayset });

describe('shared/deckRules sectionForCard', () => {
  it('routes by card type, defaulting to the main deck', () => {
    assert.equal(sectionForCard({ type: 'Legend' }), 'legend');
    assert.equal(sectionForCard({ type: 'Battlefield' }), 'battlefield');
    assert.equal(sectionForCard({ type: 'Rune' }), 'runes');
    assert.equal(sectionForCard({ type: 'Unit' }), 'main');
    assert.equal(sectionForCard({ type: 'Spell' }), 'main');
    assert.equal(sectionForCard({ type: 'Gear' }), 'main');
    assert.equal(sectionForCard({ type: null }), 'main');
  });

  it('never routes a card to the champion section', () => {
    const types = ['Legend', 'Battlefield', 'Rune', 'Unit', 'Spell', 'Gear', 'Token', null];
    for (const type of types) assert.notEqual(sectionForCard({ type }), 'champion');
  });

  it('isUserSection accepts the builder sections and rejects champion / junk', () => {
    for (const s of USER_SECTIONS) assert.ok(isUserSection(s));
    assert.equal(isUserSection('champion'), false);
    assert.equal(isUserSection('nonsense'), false);
    assert.equal(isUserSection(undefined), false);
  });
});

describe('shared/deckRules validateDeck sections', () => {
  it('an empty deck is short in every targeted section and legal in none', () => {
    const v = run([]);
    assert.equal(v.legal, false);
    assert.equal(v.totalCopies, 0);
    const under = v.issues.filter((i) => i.kind === 'section_under').map((i) => i.section).sort();
    assert.deepEqual(under, ['battlefield', 'legend', 'main', 'runes']);
    assert.equal(v.issues.some((i) => i.section === 'side'), false, 'sideboard has no target');
  });

  it('a 1/3/40/12 deck is legal', () => {
    const v = run(legalDeck());
    assert.deepEqual(v.issues, []);
    assert.equal(v.legal, true);
    assert.equal(v.totalCopies, 56);
    for (const s of v.sections) assert.ok(s.ok, `${s.section} ${s.count}/${s.target}`);
  });

  it('reports over and under against the target counts', () => {
    const over = run([...legalDeck(), line('U0', 'main', 1)]); // U0 goes to 3, main to 41
    const mainIssue = over.issues.find((i) => i.section === 'main');
    assert.equal(mainIssue?.kind, 'section_over');
    assert.match(mainIssue!.text, /41\/40/);

    const under = run([line('L1', 'legend', 1)]);
    const legend = under.sections.find((s) => s.section === 'legend');
    assert.equal(legend?.ok, true);
    assert.equal(under.issues.some((i) => i.section === 'legend'), false);
  });

  it('a sideboard adds copies but never an issue', () => {
    const v = run([...legalDeck(), line('U19', 'side', 1)]);
    assert.equal(v.totalCopies, 57);
    assert.deepEqual(v.issues, []);
    assert.equal(v.sections.find((s) => s.section === 'side')?.target, null);
    assert.equal(v.legal, true);
  });

  it('exposes every builder section in order, with targets', () => {
    const v = run([]);
    assert.deepEqual(v.sections.map((s) => s.section), [...USER_SECTIONS]);
    assert.equal(v.sections.find((s) => s.section === 'main')?.target, DECK_TARGETS.main);
  });
});

describe('shared/deckRules validateDeck playset', () => {
  it('flags a 4th copy of a normal card', () => {
    const v = run([line('V1', 'main', 4)]);
    const issue = v.issues.find((i) => i.kind === 'over_playset');
    assert.equal(issue?.card_id, 'V1');
    assert.equal(issue?.count, 4);
    assert.equal(issue?.limit, 3);
  });

  it('allows 3 copies', () => {
    assert.equal(run([line('V1', 'main', 3)]).issues.some((i) => i.kind === 'over_playset'), false);
  });

  it('counts a variant printing against its canonical card', () => {
    // 2 base + 2 alt-art = 4 copies of one logical card, even though neither line exceeds 3 on its own
    const v = run([line('V1', 'main', 2), line('V1a', 'main', 2)]);
    const issue = v.issues.find((i) => i.kind === 'over_playset');
    assert.equal(issue?.card_id, 'V1', 'reported against the canonical id');
    assert.equal(issue?.count, 4);
    assert.equal(v.issues.filter((i) => i.kind === 'over_playset').length, 1, 'one issue, not one per printing');
  });

  it('counts copies across sections, sideboard included', () => {
    const v = run([line('V1', 'main', 3), line('V1', 'side', 1)]);
    assert.equal(v.issues.find((i) => i.kind === 'over_playset')?.count, 4);
  });

  it('uses the rune playset for Rune cards', () => {
    assert.equal(run([line('R1', 'runes', 12)]).issues.some((i) => i.kind === 'over_playset'), false);
    const v = run([line('R1', 'runes', 13)]);
    const issue = v.issues.find((i) => i.kind === 'over_playset');
    assert.equal(issue?.limit, 12);
    assert.equal(issue?.count, 13);
  });

  it('honours non-default playset settings', () => {
    assert.equal(run([line('V1', 'main', 4)], 4).issues.some((i) => i.kind === 'over_playset'), false);
    assert.equal(run([line('R1', 'runes', 6)], 3, 5).issues.some((i) => i.kind === 'over_playset'), true);
  });
});

describe('shared/deckRules validateDeck misc', () => {
  it('flags a banned card once', () => {
    const v = run([line('BAN', 'main', 2)]);
    const banned = v.issues.filter((i) => i.kind === 'banned');
    assert.equal(banned.length, 1);
    assert.equal(banned[0].card_id, 'BAN');
    assert.equal(v.legal, false);
  });

  it('ignores zero and negative quantities', () => {
    const v = run([line('V1', 'main', 0), line('U0', 'main', -2)]);
    assert.equal(v.totalCopies, 0);
    assert.equal(v.sections.find((s) => s.section === 'main')?.count, 0);
  });

  it('treats an unknown card id as its own canonical card and does not throw', () => {
    const v = validateDeck({ cards: [line('WHO-999', 'main', 4)], cardsById: catalog(), playset: 3, runePlayset: 12 });
    assert.equal(v.issues.find((i) => i.kind === 'over_playset')?.card_id, 'WHO-999');
  });
});
