// Fuzzy card search scoring. Pure.
import type { Card } from './types.ts';

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUM_RE = /^([a-z]{2,4})?[-\s]?(\d{1,3})([a-z])?$/;

export interface SearchCard {
  id: string;
  set_code: string;
  number_int: number;
  number: string;
  name: string;
  _norm?: string;
}

/** Returns 0 for no match; higher = better. */
export function scoreCard(queryNorm: string, card: SearchCard, owned = false): number {
  if (!queryNorm) return 1;
  const norm = card._norm ?? (card._norm = normalize(card.name));
  let best = 0;
  // Rune prefixes and promo qualifiers do not fit the numeric shorthand grammar.
  if (queryNorm === normalize(card.id)) best = 1100;

  // number fast path: '12', '012', 'ogn 12', 'ogn-012', '12a'
  const m = queryNorm.match(NUM_RE);
  if (m) {
    const set = m[1]?.toUpperCase();
    const n = Number(m[2]);
    const suf = m[3] ?? '';
    if (card.number_int === n && (!set || card.set_code === set)) {
      const cardSuffix = card.number.replace(/^(?:t|r|sp)?\d+/i, '').toLowerCase();
      if (suf === cardSuffix) best = Math.max(best, 1000);
      else if (!suf) best = Math.max(best, 900);
    }
    if (queryNorm.replace(/\s|-/g, '') === card.id.toLowerCase().replace(/-/g, '')) best = Math.max(best, 1100);
  }

  // name prefix; a prefix that ends on a word boundary ('jinx' → 'jinx, loose cannon') outranks a partial word ('jinxed …')
  if (norm.startsWith(queryNorm)) best = Math.max(best, norm.length === queryNorm.length || norm[queryNorm.length] === ' ' ? 550 : 500);
  else {
    const words = norm.split(' ');
    if (words.some((w) => w.startsWith(queryNorm))) best = Math.max(best, 300);
    else if (norm.includes(queryNorm)) best = Math.max(best, 200);
    else {
      // multi-word: every query word must be a word-prefix somewhere
      const qs = queryNorm.split(' ');
      if (qs.length > 1 && qs.every((q) => words.some((w) => w.startsWith(q)))) best = Math.max(best, 250);
      else {
        const sub = subsequenceScore(queryNorm.replace(/\s/g, ''), norm.replace(/\s/g, ''));
        if (sub > 0) best = Math.max(best, 50 + sub);
      }
    }
  }
  if (best > 0 && owned) best += 5;
  return best;
}

/** 0 if not a subsequence; else density bonus 0..40 */
function subsequenceScore(q: string, t: string): number {
  if (q.length < 2) return 0;
  let ti = 0;
  let first = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx < 0) return 0;
    if (first < 0) first = idx;
    ti = idx + 1;
  }
  const span = ti - first;
  return Math.max(1, Math.round(40 * (q.length / span)));
}

export function searchCards<T extends SearchCard>(query: string, cards: T[], ownedIds?: Set<string>, limit = 200): T[] {
  const qn = normalize(query);
  if (!qn) return cards.slice(0, limit);
  const scored: { c: T; s: number }[] = [];
  for (const c of cards) {
    const s = scoreCard(qn, c, ownedIds?.has(c.id));
    if (s > 0) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s || a.c.set_code.localeCompare(b.c.set_code) || a.c.number_int - b.c.number_int || a.c.number.localeCompare(b.c.number));
  return scored.slice(0, limit).map((x) => x.c);
}

export type { Card };
