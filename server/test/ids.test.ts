import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fromRiotId, makeCardId, normalizeCommunityId, packEntryToId, pad3, parsePackEntry, type PackEntry } from '../../shared/ids.ts';

describe('shared/ids pad3 / makeCardId', () => {
  it('pads to three digits', () => {
    assert.equal(pad3(7), '007');
    assert.equal(pad3('45'), '045');
    assert.equal(pad3(298), '298');
    assert.equal(pad3(1000), '1000');
  });
  it('builds ids', () => {
    assert.equal(makeCardId('ogn', 7), 'OGN-007');
    assert.equal(makeCardId('OGN', 7, 'a'), 'OGN-007a');
    assert.equal(makeCardId('unl', 'T01'), 'UNL-T01');
    assert.equal(makeCardId('ven', 'SP1'), 'VEN-SP1');
  });
});

describe('shared/ids fromRiotId', () => {
  it('ogn-007a-298 → OGN-007a (alt-art suffix, main numbering)', () => {
    assert.deepEqual(fromRiotId('ogn-007a-298'), { id: 'OGN-007a', set: 'OGN', number: '007a', number_int: 7, suffix: 'a', kind: 'main' });
  });
  it('sfd-227-star-221 → SFD-227s (showcase/star → s)', () => {
    assert.deepEqual(fromRiotId('sfd-227-star-221'), { id: 'SFD-227s', set: 'SFD', number: '227s', number_int: 227, suffix: 's', kind: 'main' });
  });
  it('unl-t01 → UNL-T01 (token, 2-digit)', () => {
    assert.deepEqual(fromRiotId('unl-t01'), { id: 'UNL-T01', set: 'UNL', number: 'T01', number_int: 1, suffix: '', kind: 'token' });
  });
  it('ven-r01 → VEN-R01 (rune, 2-digit)', () => {
    assert.deepEqual(fromRiotId('ven-r01'), { id: 'VEN-R01', set: 'VEN', number: 'R01', number_int: 1, suffix: '', kind: 'rune' });
  });
  it('ven-sp3-006 → VEN-SP3 (special, unpadded)', () => {
    assert.deepEqual(fromRiotId('ven-sp3-006'), { id: 'VEN-SP3', set: 'VEN', number: 'SP3', number_int: 3, suffix: '', kind: 'special' });
  });
  it('ogn-299-298 → OGN-299 (overnumbered, no suffix)', () => {
    assert.deepEqual(fromRiotId('ogn-299-298'), { id: 'OGN-299', set: 'OGN', number: '299', number_int: 299, suffix: '', kind: 'main' });
  });
  it('is case-insensitive and rejects garbage', () => {
    assert.equal(fromRiotId('OGN-007A-298')?.id, 'OGN-007a');
    assert.equal(fromRiotId('ogn-7-298')?.id, 'OGN-007');
    assert.equal(fromRiotId(''), null);
    assert.equal(fromRiotId('nonsense'), null);
    assert.equal(fromRiotId('ogn-'), null);
    assert.equal(fromRiotId('ogn-abc-298'), null);
  });
});

describe('shared/ids normalizeCommunityId', () => {
  it('maps community spellings onto our ids', () => {
    assert.equal(normalizeCommunityId('OGN-303-STAR'), 'OGN-303s');
    assert.equal(normalizeCommunityId('ogn-303*'), 'OGN-303s');
    assert.equal(normalizeCommunityId('OGN-066A'), 'OGN-066a');
    assert.equal(normalizeCommunityId('VEN-R02a'), 'VEN-R02a');
    assert.equal(normalizeCommunityId(' ogn-7 '), 'OGN-007');
    assert.equal(normalizeCommunityId('ven-sp1'), 'VEN-SP1');
    assert.equal(normalizeCommunityId('unl-t1'), 'UNL-T01');
    assert.equal(normalizeCommunityId('OGN-001'), 'OGN-001');
  });
  it('preserves distinct promo printings and normalizes collector codes', () => {
    for (const [raw, expected] of [
      ['OGN-066-P', 'OGN-066-P'], ['sfd-116-p', 'SFD-116-P'], ['VEN-R01B-P', 'VEN-R01b-P'],
      ['SFD-139-P2', 'SFD-139-P2'], ['unl-058-p-champion', 'UNL-058-P-CHAMPION'],
      ['SGN - 001/003 - P', 'SGN-001-P'], ['OGN-263-a', 'OGN-263a'], ['OGN-P', 'OGN-P'],
      ['OGN-279/298-OVERSIZED', 'OGN-279-OVERSIZED'], ['OGN-043/298', 'OGN-043'],
    ]) {
      assert.equal(normalizeCommunityId(raw), expected);
      assert.equal(normalizeCommunityId(expected), expected);
    }
  });
  it('rejects unparseable and unsafe input', () => {
    assert.equal(normalizeCommunityId('Jinx, Loose Cannon'), null);
    assert.equal(normalizeCommunityId(''), null);
    assert.equal(normalizeCommunityId('../OGN-043'), null);
    assert.equal(normalizeCommunityId('OGN-043/../../secret'), null);
  });
});

describe('shared/ids parsePackEntry', () => {
  const base: PackEntry = { set_code: null, prefix: '', number_int: 12, suffix: '', finish: 'normal', qty: 1 };

  it('parses the documented grammar', () => {
    assert.deepEqual(parsePackEntry('12'), base);
    assert.deepEqual(parsePackEntry('012'), base);
    assert.deepEqual(parsePackEntry('12f'), { ...base, finish: 'foil' });
    assert.deepEqual(parsePackEntry('12x3'), { ...base, qty: 3 });
    assert.deepEqual(parsePackEntry('12*3'), { ...base, qty: 3 });
    assert.deepEqual(parsePackEntry('ogn45'), { ...base, set_code: 'OGN', number_int: 45 });
    assert.deepEqual(parsePackEntry('OGN-045'), { ...base, set_code: 'OGN', number_int: 45 });
    assert.deepEqual(parsePackEntry('7a'), { ...base, number_int: 7, suffix: 'a' });
    assert.deepEqual(parsePackEntry('r1'), { ...base, prefix: 'R', number_int: 1 });
    assert.deepEqual(parsePackEntry('t2f'), { ...base, prefix: 'T', number_int: 2, finish: 'foil' });
    // specials need the set spelled out: a bare 'sp3' is read as set 'SP' (2-4 letters win over the SP prefix)
    assert.deepEqual(parsePackEntry('ogn-sp3'), { ...base, set_code: 'OGN', prefix: 'SP', number_int: 3 });
    assert.deepEqual(parsePackEntry('VEN-SP1f'), { ...base, set_code: 'VEN', prefix: 'SP', number_int: 1, finish: 'foil' });
    assert.deepEqual(parsePackEntry('12af'), { ...base, suffix: 'a', finish: 'foil' });
    assert.deepEqual(parsePackEntry('12fx2'), { ...base, finish: 'foil', qty: 2 });
    assert.deepEqual(parsePackEntry(' 1 2 '), base); // whitespace ignored
    assert.deepEqual(parsePackEntry('999'), { ...base, number_int: 999 });
  });

  it('honours foilDefault (explicit f still wins)', () => {
    assert.equal(parsePackEntry('12', true)?.finish, 'foil');
    assert.equal(parsePackEntry('12f', true)?.finish, 'foil');
    assert.equal(parsePackEntry('12', false)?.finish, 'normal');
  });

  it('rejects junk', () => {
    assert.equal(parsePackEntry('abc'), null);
    assert.equal(parsePackEntry(''), null);
    assert.equal(parsePackEntry('   '), null);
    assert.equal(parsePackEntry('0'), null);
    assert.equal(parsePackEntry('000'), null);
    assert.equal(parsePackEntry('1000'), null);
    assert.equal(parsePackEntry('12xx'), null);
    assert.equal(parsePackEntry('x3'), null);
    assert.equal(parsePackEntry('12-3'), null);
  });

  it('qty is at least 1', () => {
    assert.equal(parsePackEntry('12x0')?.qty, 1);
  });
});

describe('shared/ids packEntryToId', () => {
  const id = (s: string, set = 'OGN') => packEntryToId(parsePackEntry(s)!, set);
  it('resolves entries against the current set', () => {
    assert.equal(id('12'), 'OGN-012');
    assert.equal(id('012'), 'OGN-012');
    assert.equal(id('7a'), 'OGN-007a');
    assert.equal(id('r1'), 'OGN-R01');
    assert.equal(id('t2f'), 'OGN-T02');
    assert.equal(id('ogn-sp3'), 'OGN-SP3');
    assert.equal(id('12', 'sfd'), 'sfd-012'); // current set is used verbatim
  });
  it('an explicit set prefix overrides the current set', () => {
    assert.equal(id('ogn45', 'SFD'), 'OGN-045');
    assert.equal(id('OGN-045', 'SFD'), 'OGN-045');
    assert.equal(id('unl-t1', 'OGN'), 'UNL-T01');
  });
  it('round-trips through fromRiotId-style ids', () => {
    for (const [entry, riot] of [
      ['7a', 'ogn-007a-298'],
      ['r1', 'ogn-r01'],
      ['t1', 'ogn-t01'],
      ['ogn-sp3', 'ogn-sp3-006'],
      ['299', 'ogn-299-298'],
    ] as const) {
      assert.equal(id(entry), fromRiotId(riot)!.id);
    }
  });
});
