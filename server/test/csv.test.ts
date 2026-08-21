import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvEscape, parseCsv, serializeCsv } from '../../shared/csv.ts';
import { CSV_HEADER } from '../../shared/constants.ts';

const BOM = '﻿';

describe('shared/csv parseCsv', () => {
  it('parses a plain LF file', () => {
    assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('strips a leading BOM', () => {
    const rows = parseCsv(`${BOM}card_id,qty\nOGN-001,3\n`);
    assert.deepEqual(rows, [
      ['card_id', 'qty'],
      ['OGN-001', '3'],
    ]);
    assert.equal(rows[0][0], 'card_id'); // no invisible BOM glued onto the first header
  });

  it('handles CRLF line endings (Excel export)', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4\r\n'), [
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('handles quoted commas', () => {
    assert.deepEqual(parseCsv('"Jinx, Loose Cannon",3\n'), [['Jinx, Loose Cannon', '3']]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    assert.deepEqual(parseCsv('"say ""hi""",x\n'), [['say "hi"', 'x']]);
    assert.deepEqual(parseCsv('""""\n'), [['"']]);
  });

  it('handles newlines inside quoted fields (LF and CRLF)', () => {
    assert.deepEqual(parseCsv('"line1\nline2",z\n'), [['line1\nline2', 'z']]);
    // CR is only a line-ending outside quotes; inside a quoted field it is preserved verbatim
    assert.deepEqual(parseCsv('"line1\r\nline2",z\r\n'), [['line1\r\nline2', 'z']]);
  });

  it('is identical with and without a trailing newline', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), parseCsv('a,b\n1,2\n'));
    assert.deepEqual(parseCsv('a,b\n1,2\n\n\n'), parseCsv('a,b\n1,2'));
  });

  it('keeps empty fields and empty quoted fields', () => {
    assert.deepEqual(parseCsv('a,,c\n'), [['a', '', 'c']]);
    assert.deepEqual(parseCsv(',\nx\n'), [['', ''], ['x']]);
    assert.deepEqual(parseCsv('"",x\n'), [['', 'x']]);
    // a trailing row made only of empty fields counts as "fully empty" and is dropped
    assert.deepEqual(parseCsv(',\n'), []);
    assert.deepEqual(parseCsv('a,b\n,\n'), [['a', 'b']]);
  });

  it('drops fully empty trailing rows but keeps interior blank lines as empty rows', () => {
    assert.deepEqual(parseCsv('a\n\nb\n\n'), [['a'], [''], ['b']]);
  });

  it('returns [] for empty input / BOM-only input', () => {
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv(BOM), []);
    assert.deepEqual(parseCsv('\n\r\n'), []);
  });

  it('tolerates an unterminated quoted field at EOF', () => {
    assert.deepEqual(parseCsv('a,"open'), [['a', 'open']]);
  });
});

describe('shared/csv serializeCsv / csvEscape', () => {
  it('escapes only when needed', () => {
    assert.equal(csvEscape('plain'), 'plain');
    assert.equal(csvEscape('has,comma'), '"has,comma"');
    assert.equal(csvEscape('has "quote"'), '"has ""quote"""');
    assert.equal(csvEscape('multi\nline'), '"multi\nline"');
    assert.equal(csvEscape('cr\rhere'), '"cr\rhere"');
    assert.equal(csvEscape(null), '');
    assert.equal(csvEscape(undefined), '');
    assert.equal(csvEscape(0), '0');
    assert.equal(csvEscape(12), '12');
  });

  it('uses CRLF by default and ends with a line terminator', () => {
    assert.equal(serializeCsv([['a', 'b'], [1, 2]]), 'a,b\r\n1,2\r\n');
  });

  it('supports bom and eol options', () => {
    const s = serializeCsv([['a']], { bom: true, eol: '\n' });
    assert.equal(s, `${BOM}a\n`);
    assert.equal(s.charCodeAt(0), 0xfeff);
  });

  it('round-trips awkward values through serialize → parse', () => {
    const rows = [
      ['id', 'name', 'note'],
      ['OGN-001', 'Jinx, Loose Cannon', 'she said "boom"'],
      ['OGN-002', 'Line\nBreak', ''],
      ['OGN-003', ' leading and trailing ', 'comma, "quote", and\r\nCRLF'],
      ['OGN-004', 'ünïcödé ✦', '12'],
    ];
    const text = serializeCsv(rows, { bom: true });
    // values containing CR/LF/comma/quote are quoted by csvEscape, so the round trip is byte-identical
    assert.deepEqual(parseCsv(text), rows);
  });
});

describe('shared/csv export → import shape', () => {
  it('round-trips inventory rows through the export header', () => {
    const inventory = [
      { card_id: 'OGN-001', set_code: 'OGN', number: '001', name: 'Blazing Scorcher', finish: 'normal', qty: 3, note: '' },
      { card_id: 'OGN-251', set_code: 'OGN', number: '251', name: 'Jinx, Loose Cannon', finish: 'foil', qty: 1, note: 'signed, "mint"' },
      { card_id: 'OGN-036a', set_code: 'OGN', number: '036a', name: 'Vi, Destructive', finish: 'normal', qty: 0, note: 'want\nalt art' },
    ];
    const text = serializeCsv([[...CSV_HEADER], ...inventory.map((r) => [r.card_id, r.set_code, r.number, r.name, r.finish, r.qty, r.note])], { bom: true });

    assert.ok(text.startsWith(`${BOM}card_id,set_code,number,name,finish,qty,note\r\n`));

    const rows = parseCsv(text);
    const header = rows[0];
    assert.deepEqual(header, [...CSV_HEADER]);
    const col = Object.fromEntries(header.map((h, i) => [h, i])) as Record<(typeof CSV_HEADER)[number], number>;

    const items = rows.slice(1).map((r) => ({
      card_id: r[col.card_id],
      finish: r[col.finish],
      qty: Number(r[col.qty]),
      note: r[col.note],
    }));
    assert.deepEqual(
      items,
      inventory.map((r) => ({ card_id: r.card_id, finish: r.finish, qty: r.qty, note: r.note })),
    );
    // header lookup must be by name so a reordered/partial CSV still imports
    const reordered = `${BOM}qty,card_id,finish\r\n2,OGN-001,foil\r\n`;
    const r2 = parseCsv(reordered);
    const c2 = Object.fromEntries(r2[0].map((h, i) => [h, i]));
    assert.deepEqual({ card_id: r2[1][c2.card_id], finish: r2[1][c2.finish], qty: Number(r2[1][c2.qty]) }, { card_id: 'OGN-001', finish: 'foil', qty: 2 });
  });
});
