// Offline unit tests for the pure helpers of the Codex tip generator (sync/tips.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, cardLine, clampWords, groupCards, parseCodexOutput, MAX_TIP_CHARS, MAX_TIP_WORDS, TIP_SCHEMA, type TipCard } from '../../sync/tips.ts';

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const jinx: TipCard = {
  id: 'OGN-030',
  name: 'Jinx, Demolitionist',
  type: 'Unit',
  supertype: 'Champion',
  domains: ['fury', 'chaos'],
  energy: 4,
  might: 4,
  power: 1,
  rarity: 'Rare',
  rules_text: 'When I am played, deal 2 damage to an enemy unit here.\nDeathknell — Deal 1 damage to each enemy unit at this battlefield.',
};
const rune: TipCard = { id: 'OGN-007', name: 'Fury Rune', type: 'Rune', supertype: 'Basic', domains: ['fury'], energy: null, might: null, power: null, rarity: null, rules_text: null };
const charm: TipCard = { id: 'OGN-043', name: 'Charm', type: 'Spell', supertype: null, domains: ['calm'], energy: 1, might: null, power: 1, rarity: 'Uncommon', rules_text: 'Reaction — Choose an enemy unit. Exhaust it.' };

// ---------------------------------------------------------------- clampWords

test('clampWords: short text is normalised but otherwise untouched', () => {
  assert.equal(clampWords('  Hold it   for the\nshowdown.  '), 'Hold it for the showdown.');
  assert.equal(clampWords('"Play it early."'), 'Play it early.');
  assert.equal(clampWords('- Play it early.'), 'Play it early.');
  assert.equal(clampWords('1. Play it early.'), 'Play it early.');
  assert.equal(clampWords(''), '');
  assert.equal(clampWords('   '), '');
});

test('clampWords: >50 words is cut at the last sentence end within 50 words', () => {
  const text = Array.from({ length: 20 }, () => 'Play it early.').join(' '); // 60 words, sentence every 3
  const out = clampWords(text);
  assert.equal(words(out), 48);
  assert.ok(out.endsWith('.'));
  assert.ok(words(out) <= MAX_TIP_WORDS);
});

test('clampWords: sentence ends followed by quotes/brackets count as boundaries', () => {
  const text = Array.from({ length: 24 }, (_, i) => (i === 15 ? 'word!)' : 'word')).join(' ') + ' ' + Array.from({ length: 40 }, () => 'tail').join(' ');
  const out = clampWords(text); // 64 words; only boundary is word 16
  assert.equal(words(out), 16);
  assert.ok(out.endsWith('word!)'));
});

test('clampWords: no sentence end → hard cut at 50 words, trailing punctuation stripped', () => {
  const text = Array.from({ length: 70 }, (_, i) => (i === 49 ? 'w50,' : `w${i + 1}`)).join(' ');
  const out = clampWords(text);
  assert.equal(words(out), 50);
  assert.ok(out.endsWith('w50'), out.slice(-10));
});

test('clampWords: enforces the 400-character cap too', () => {
  const long = Array.from({ length: 45 }, (_, i) => `${'x'.repeat(12)}${i % 9 === 8 ? '.' : ''}`).join(' '); // 45 words, ~585 chars
  const out = clampWords(long);
  assert.ok(out.length <= MAX_TIP_CHARS, String(out.length));
  assert.ok(out.endsWith('.'), out.slice(-5));
  const noStops = Array.from({ length: 45 }, () => 'y'.repeat(12)).join(' ');
  const out2 = clampWords(noStops);
  assert.ok(out2.length <= MAX_TIP_CHARS);
  assert.ok(!out2.endsWith(' '));
  assert.ok(out2.length >= MAX_TIP_CHARS - 13);
});

// ---------------------------------------------------------------- parseCodexOutput

test('parseCodexOutput: plain JSON', () => {
  const r = parseCodexOutput('{"tips":[{"id":"OGN-030","tip":"Play it when the enemy has units at your battlefield."}]}', ['OGN-030']);
  assert.equal(r.tips.get('OGN-030'), 'Play it when the enemy has units at your battlefield.');
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unknown, []);
});

test('parseCodexOutput: strips ``` fences and surrounding prose, tolerates a BOM', () => {
  const bom = String.fromCharCode(0xfeff);
  const raw = `${bom}Here you go:\n\`\`\`json\n{"tips":[{"id":"OGN-030","tip":"  Hold it. "},{"id":"OGN-043","tip":"React to attacks."}]}\n\`\`\`\nDone.`;
  const r = parseCodexOutput(raw, ['OGN-030', 'OGN-043']);
  assert.equal(r.tips.size, 2);
  assert.equal(r.tips.get('OGN-030'), 'Hold it.');
  assert.equal(r.tips.get('OGN-043'), 'React to attacks.');
});

test('parseCodexOutput: ids ⊆ batch — unknown ids reported, case-insensitive match, missing listed, first wins', () => {
  const raw = JSON.stringify({
    tips: [
      { id: 'ogn-030', tip: 'First.' },
      { id: 'OGN-030', tip: 'Second (ignored).' },
      { id: 'OGN-999', tip: 'Not in batch.' },
      { id: 'OGN-043', tip: '   ' },
      { id: 'OGN-007', tip: 42 },
      'garbage',
    ],
  });
  const r = parseCodexOutput(raw, ['OGN-030', 'OGN-043', 'OGN-007', 'OGN-001']);
  assert.equal(r.tips.get('OGN-030'), 'First.');
  assert.deepEqual(r.unknown, ['OGN-999']);
  assert.deepEqual(r.missing.sort(), ['OGN-001', 'OGN-007', 'OGN-043']);
});

test('parseCodexOutput: long tips are clamped on the way in', () => {
  const tip = Array.from({ length: 30 }, () => 'Keep it up.').join(' '); // 90 words
  const r = parseCodexOutput(JSON.stringify({ tips: [{ id: 'A', tip }] }), ['A']);
  assert.ok(words(r.tips.get('A')!) <= MAX_TIP_WORDS);
});

test('parseCodexOutput: invalid shapes throw', () => {
  assert.throws(() => parseCodexOutput('no json here', ['A']), /no JSON object/);
  assert.throws(() => parseCodexOutput('{"tips":[}', ['A']), /invalid JSON/);
  assert.throws(() => parseCodexOutput('{"result":[]}', ['A']), /"tips" array/);
  assert.throws(() => parseCodexOutput('[{"id":"A","tip":"x"}]', ['A']), /"tips" array/); // bare array: inner object is sliced, lacks "tips"
  assert.throws(() => parseCodexOutput('', ['A']), /no JSON object/);
});

// ---------------------------------------------------------------- buildPrompt / cardLine

test('cardLine: spec format, nulls as "-", domains labelled, rules collapsed to one line', () => {
  const l = cardLine(jinx);
  assert.ok(l.startsWith('- id: OGN-030 | Jinx, Demolitionist | Unit | Champion | Fury/Chaos | energy 4 | might 4 | power 1 | Rare | rules: '));
  assert.ok(!l.includes('\n'));
  assert.ok(l.includes('deal 2 damage to an enemy unit here. Deathknell — Deal 1 damage'));
  assert.equal(cardLine(rune), '- id: OGN-007 | Fury Rune | Rune | Basic | Fury | energy - | might - | power - | - | rules: (no rules text)');
  assert.ok(cardLine(charm).includes('| Spell | - | Calm | energy 1 | might - | power 1 | Uncommon |'));
});

test('buildPrompt: persona, rules, glossary, schema instruction and one line per card', () => {
  const p = buildPrompt([jinx, charm, rune]);
  assert.match(p, /expert coach for Riftbound/);
  assert.match(p, /Max 45 words/);
  assert.match(p, /Imperative voice/);
  assert.match(p, /Do not repeat the card's name/);
  assert.match(p, /common mistake/);
  assert.match(p, /Do not invent mechanics/);
  assert.match(p, /\{"tips":\[\{"id":"...","tip":"..."\}\]\}/);
  for (const k of ['Accelerate', 'Ganking', 'Empower', 'Flow', 'Legion', 'Deflect', 'Hidden', 'Shield', 'Temporary', 'Vision', 'Deathknell', 'Reaction', 'Action', 'Showdown', 'Assault', 'Tank', 'Quick', 'Exhaust']) {
    assert.ok(p.includes(`- ${k}`), `glossary missing ${k}`);
  }
  const lines = p.split('\n').filter((l) => l.startsWith('- id: '));
  assert.deepEqual(
    lines.map((l) => l.split(' | ')[0]),
    ['- id: OGN-030', '- id: OGN-043', '- id: OGN-007'],
  );
  assert.match(p, /Cards \(3\)/);
  assert.ok(p.endsWith('\n'));
});

// ---------------------------------------------------------------- groupCards / schema

test('groupCards: identical name+type+rules printings share one entry, order preserved, first is representative', () => {
  const alt: TipCard = { ...jinx, id: 'OGN-030a' };
  const sig: TipCard = { ...jinx, id: 'OGN-030s', rules_text: jinx.rules_text!.replace(/\s+/g, '  ') };
  const other: TipCard = { ...jinx, id: 'UNL-030', rules_text: 'Different text.' };
  const g = groupCards([jinx, charm, alt, rune, sig, other]);
  assert.deepEqual(
    g.map((x) => [x.rep.id, x.ids]),
    [
      ['OGN-030', ['OGN-030', 'OGN-030a', 'OGN-030s']],
      ['OGN-043', ['OGN-043']],
      ['OGN-007', ['OGN-007']],
      ['UNL-030', ['UNL-030']],
    ],
  );
});

test('TIP_SCHEMA is the strict shape codex expects', () => {
  assert.equal(TIP_SCHEMA.type, 'object');
  assert.equal(TIP_SCHEMA.additionalProperties, false);
  assert.deepEqual(TIP_SCHEMA.required, ['tips']);
  assert.equal(TIP_SCHEMA.properties.tips.items.additionalProperties, false);
  assert.deepEqual(TIP_SCHEMA.properties.tips.items.required, ['id', 'tip']);
  assert.equal(TIP_SCHEMA.properties.tips.items.properties.tip.maxLength, 320);
});
