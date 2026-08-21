// Card id helpers + pack-mode entry grammar. Pure.
import type { Finish } from './types.ts';

export function pad3(n: number | string): string {
  const s = String(n);
  return s.length >= 3 ? s : '0'.repeat(3 - s.length) + s;
}

/** 'OGN' + '7' + 'a' -> 'OGN-007a' ; tokens/runes/specials keep their prefix: 'UNL-T01', 'VEN-R01', 'VEN-SP1' */
export function makeCardId(set: string, number: string | number, suffix = ''): string {
  return `${set.toUpperCase()}-${typeof number === 'number' ? pad3(number) : number}${suffix}`;
}

/**
 * Convert a Riot gallery id ('ogn-007a-298', 'sfd-227-star-221', 'unl-t01', 'ven-r01', 'ven-sp3-006')
 * into our id ('OGN-007a', 'SFD-227s', 'UNL-T01', 'VEN-R01', 'VEN-SP3') plus parts.
 */
export function fromRiotId(riotId: string): { id: string; set: string; number: string; number_int: number; suffix: string; kind: 'main' | 'token' | 'rune' | 'special' } | null {
  const m = riotId.toLowerCase().match(/^([a-z0-9]+)-(t|r|sp)?(\d+)([a-z]?)(?:-star)?(?:-(\d+))?$/);
  if (!m) return null;
  const set = m[1].toUpperCase();
  const prefix = (m[2] ?? '').toUpperCase();
  const digits = m[3];
  let suffix = m[4] ?? '';
  if (/-star/.test(riotId.toLowerCase())) suffix = 's';
  const number_int = Number(digits);
  const numStr = prefix === 'SP' ? `${prefix}${number_int}` : prefix ? `${prefix}${pad3(number_int).slice(-2).padStart(2, '0')}` : pad3(number_int);
  // tokens/runes are 2-digit in Riot ids (T01, R01); keep 2 digits for them
  const number = prefix && prefix !== 'SP' ? `${prefix}${String(number_int).padStart(2, '0')}` : numStr;
  const kind = prefix === 'T' ? 'token' : prefix === 'R' ? 'rune' : prefix === 'SP' ? 'special' : 'main';
  return { id: `${set}-${number}${suffix}`, set, number: `${number}${suffix}`, number_int, suffix, kind };
}

/** Normalise community ids ('OGN-303-STAR', 'ogn-303*', 'OGN-066A', 'OGN-066-P') to ours; returns null for promos (-P). */
export function normalizeCommunityId(raw: string): string | null {
  let s = raw.trim().toUpperCase();
  if (/-P$/.test(s)) return null;
  s = s.replace(/-STAR$/, 's').replace(/\*$/, 's');
  const m = s.match(/^([A-Z0-9]+)-(T|R|SP)?(\d+)([A-Z]?)$/i);
  if (!m) return null;
  const set = m[1];
  const prefix = (m[2] ?? '').toUpperCase();
  const n = Number(m[3]);
  const suffix = (m[4] ?? '').toLowerCase();
  if (prefix === 'SP') return `${set}-SP${n}${suffix}`;
  if (prefix) return `${set}-${prefix}${String(n).padStart(2, '0')}${suffix}`;
  return `${set}-${pad3(n)}${suffix}`;
}

export interface PackEntry {
  set_code: string | null; // null = use current set
  prefix: '' | 'T' | 'R' | 'SP';
  number_int: number;
  suffix: string; // 'a' | 'b' | 's' | ''
  finish: Finish;
  qty: number;
}

const PACK_RE = /^(?:([a-z]{2,4})-?)?(t|r|sp)?(\d{1,3})([a-z]?)(f)?(?:[x*](\d{1,3}))?$/i;

/** Parse pack-mode input: '45', '045', '45f', '45x3', '45*3', 'ogn45', 'OGN-045', 'r1', 't2f', '7a'. */
export function parsePackEntry(input: string, foilDefault = false): PackEntry | null {
  const s = input.replace(/\s+/g, '').toLowerCase();
  if (!s) return null;
  const m = s.match(PACK_RE);
  if (!m) return null;
  const set = m[1] ? m[1].toUpperCase() : null;
  const prefix = (m[2] ? m[2].toUpperCase() : '') as PackEntry['prefix'];
  const number_int = Number(m[3]);
  let suffix = m[4] ?? '';
  let finish: Finish = foilDefault ? 'foil' : 'normal';
  if (m[5]) finish = 'foil';
  // 'f' captured as suffix when no finish flag: e.g. '45f' -> suffix '' finish foil handled by group 5; '45ff'? ignore
  if (suffix === 'f' && !m[5]) {
    suffix = '';
    finish = 'foil';
  }
  const qty = m[6] ? Math.max(1, Number(m[6])) : 1;
  if (!Number.isFinite(number_int) || number_int <= 0) return null;
  return { set_code: set, prefix, number_int, suffix, finish, qty };
}

/** Build the card id a pack entry refers to within a set. */
export function packEntryToId(e: PackEntry, currentSet: string): string {
  const set = e.set_code ?? currentSet;
  if (e.prefix === 'SP') return `${set}-SP${e.number_int}${e.suffix}`;
  if (e.prefix) return `${set}-${e.prefix}${String(e.number_int).padStart(2, '0')}${e.suffix}`;
  return `${set}-${pad3(e.number_int)}${e.suffix}`;
}
