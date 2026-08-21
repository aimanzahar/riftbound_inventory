import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, scoreCard, searchCards, type SearchCard } from '../../shared/search.ts';

function card(id: string, name: string): SearchCard {
  const [set_code, number] = id.split('-');
  return { id, set_code, number, number_int: parseInt(number.replace(/^(?:T|R|SP)/i, ''), 10), name };
}

// Deliberately ordered so that tie-breaks on collector number would NOT rescue a wrong ranking:
// 'Jinxed Mechanism' (020) sorts before 'Jinx, Loose Cannon' (251) by number.
const CARDS: SearchCard[] = [
  card('OGN-001', 'Blazing Scorcher'),
  card('OGN-012', 'Smoldering Yordle'),
  card('OGN-012a', 'Smoldering Yordle'),
  card('OGN-020', 'Jinxed Mechanism'),
  card('OGN-030', 'Jinx, Demolitionist'),
  card('OGN-043', 'Charm'),
  card('OGN-088', 'Mega-Mech'),
  card('OGN-251', 'Jinx, Loose Cannon'),
  card('OGS-014', 'Lux, Crownguard'),
  card('OGS-021', 'Lux, Lady of Luminosity'),
  card('SFD-012', 'Gem Jammer'),
  card('UNL-100', 'Séjuani, Frost Rider'),
];
const ids = (q: string, owned?: Set<string>, limit?: number) => searchCards(q, CARDS, owned, limit).map((c) => c.id);

describe('shared/search normalize', () => {
  it('lowercases, strips diacritics and punctuation, collapses whitespace', () => {
    assert.equal(normalize('Jinx, Loose Cannon'), 'jinx loose cannon');
    assert.equal(normalize('  Séjuani,  Frost!  Rider '), 'sejuani frost rider');
    assert.equal(normalize('Mega-Mech'), 'mega mech');
    assert.equal(normalize('OGN-012'), 'ogn 012');
    assert.equal(normalize(''), '');
  });
});

describe('shared/search ranking', () => {
  it("'jinx' ranks whole-word Jinx cards above 'Jinxed …'", () => {
    const r = ids('jinx');
    assert.ok(r.includes('OGN-251') && r.includes('OGN-030') && r.includes('OGN-020'), r.join(','));
    assert.ok(r.indexOf('OGN-251') < r.indexOf('OGN-020'), `expected Jinx, Loose Cannon above Jinxed Mechanism: ${r.join(',')}`);
    assert.ok(r.indexOf('OGN-030') < r.indexOf('OGN-020'));
    assert.deepEqual(r.slice(0, 2).sort(), ['OGN-030', 'OGN-251']);
    assert.ok(!r.includes('OGN-043'));
  });

  it("'jinx loose' / full punctuated name → Jinx, Loose Cannon first and alone", () => {
    assert.deepEqual(ids('jinx loose'), ['OGN-251']);
    assert.equal(ids('Jinx, Loose Cannon')[0], 'OGN-251');
    assert.equal(ids('JINX LOOSE CANNON')[0], 'OGN-251');
  });

  it("'012' hits OGN-012 at the top (then its alt-art and other sets' #12)", () => {
    const r = ids('012');
    assert.equal(r[0], 'OGN-012');
    assert.ok(r.includes('OGN-012a'));
    assert.ok(r.includes('SFD-012'));
    assert.ok(r.indexOf('OGN-012') < r.indexOf('OGN-012a'));
    assert.equal(ids('12')[0], 'OGN-012');
  });

  it("'ogn-012' / 'OGN 012' / 'ogn012' hit OGN-012 at the top and exclude other sets", () => {
    for (const q of ['ogn-012', 'OGN 012', 'ogn012', 'OGN-12']) {
      const r = ids(q);
      assert.equal(r[0], 'OGN-012', `${q}: ${r.join(',')}`);
      assert.ok(!r.includes('SFD-012'), `${q} should not match SFD-012`);
    }
    assert.equal(ids('sfd 12')[0], 'SFD-012');
  });

  it("'12a' targets the alt-art printing", () => {
    const r = ids('12a');
    assert.equal(r[0], 'OGN-012a');
    assert.ok(!r.includes('OGN-012'));
  });

  it("'jnx' matches Jinx by subsequence (and nothing unrelated)", () => {
    const r = ids('jnx');
    assert.ok(r.includes('OGN-251'), r.join(','));
    assert.ok(r.includes('OGN-030'));
    assert.ok(!r.includes('OGN-043'));
    assert.ok(!r.includes('OGS-021'));
    assert.ok(!r.includes('OGN-001'));
    // denser subsequences score higher than sparse ones
    assert.ok(scoreCard('jnx', card('X-001', 'Jinx')) > scoreCard('jnx', card('X-002', 'Jeering Nexus Xerath')));
  });

  it("multi-word 'lux lum' → Lux, Lady of Luminosity only", () => {
    assert.deepEqual(ids('lux lum'), ['OGS-021']);
    assert.deepEqual(ids('lady lum'), ['OGS-021']);
    assert.deepEqual(ids('lux'), ['OGS-014', 'OGS-021']); // both Lux cards, number order
  });

  it('word-prefix and substring matches', () => {
    assert.deepEqual(ids('cannon'), ['OGN-251']);
    assert.deepEqual(ids('mega mech'), ['OGN-088']);
    assert.equal(ids('sejuani')[0], 'UNL-100');
    assert.equal(ids('Séjuani')[0], 'UNL-100');
    assert.equal(ids('zzzz').length, 0);
  });

  it('empty query returns cards in catalog order, honouring limit', () => {
    assert.deepEqual(
      ids(''),
      CARDS.map((c) => c.id),
    );
    assert.deepEqual(ids('   '), CARDS.map((c) => c.id));
    assert.equal(ids('', undefined, 3).length, 3);
    assert.equal(ids('jinx', undefined, 1).length, 1);
  });

  it('owned cards get a small tie-break bonus', () => {
    assert.equal(ids('jinx')[0], 'OGN-030'); // equal score → lower number first
    assert.equal(ids('jinx', new Set(['OGN-251']))[0], 'OGN-251');
    assert.ok(scoreCard('jinx', card('X-001', 'Jinx'), true) > scoreCard('jinx', card('X-001', 'Jinx'), false));
    assert.equal(scoreCard('zzzz', card('X-001', 'Jinx'), true), 0); // no bonus on a non-match
  });

  it('scoreCard tiers: exact id > number > name prefix > word prefix > substring > subsequence', () => {
    const c = card('OGN-012', 'Smoldering Yordle');
    const sId = scoreCard(normalize('ogn-012'), c);
    const sNum = scoreCard(normalize('012'), c);
    const sPrefix = scoreCard(normalize('smold'), c);
    const sWord = scoreCard(normalize('yord'), c);
    const sSub = scoreCard(normalize('dering'), c);
    const sSeq = scoreCard(normalize('smyr'), c);
    assert.ok(sId > sNum && sNum > sPrefix && sPrefix > sWord && sWord > sSub && sSub > sSeq && sSeq > 0, [sId, sNum, sPrefix, sWord, sSub, sSeq].join(' > '));
    assert.equal(scoreCard('', c), 1);
  });
});
