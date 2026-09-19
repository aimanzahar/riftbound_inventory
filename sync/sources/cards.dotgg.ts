// DotGG supplements Riot's gallery with missing printings, finishes and market IDs.
// `https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed` → { names: string[], data: unknown[][] }
import type { JobCtx } from '../types.ts';
import type { CardJoinRow, CardSourceResult, SourceCard } from './types.ts';
import { fetchJson } from '../lib/http.ts';
import { communityCardParts, normalizeCommunityId } from '../../shared/ids.ts';
import { htmlToText, KNOWN_RELEASE_DATES } from './cards.riot.ts';

export const DOTGG_CARDS_URL = 'https://api.dotgg.gg/cgfw/getcards?game=riftbound&mode=indexed';

export interface DotggRow extends CardJoinRow {
  dotgg_id: string; // raw id as dotgg has it ('OGN-303-STAR')
  name: string | null;
  card: SourceCard | null;
  set_name: string | null;
}

export interface Indexed {
  names?: string[];
  data?: unknown[][];
}

function flag(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return null;
}
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function firstInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const m = String(v).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function numeric(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function mapCard(get: (key: string) => unknown, id: string): SourceCard | null {
  const parts = communityCardParts(id);
  const name = text(get('name'));
  if (!parts || !name) return null;
  const supertype = text(get('supertype'));
  const type = strings(get('type'))[0] ?? (supertype === 'Token' || /^T\d/.test(parts.number) ? 'Token' : null);
  const effect = text(get('effect'));
  const rules = htmlToText(effect);
  return {
    id, set_code: parts.set, number: parts.number, number_int: parts.number_int, suffix: parts.suffix,
    riot_id: null, public_code: null, name, canonical_name: text(get('name_normal')) ?? name,
    printing_kind: id.endsWith('-OVERSIZED') ? 'oversized' : flag(get('promo')) || /-P(?:\d|$|-)/.test(id) ? 'promo' : null,
    type, supertype, domains: strings(get('color')).map((s) => s.toLowerCase()),
    energy: numeric(get('cost')), power: numeric(get('power')), might: numeric(get('might')),
    rarity: text(get('rarity')), rules_text: rules === '[NO TEXT]' ? null : rules,
    // Community text is displayed as plain text, never injected as HTML.
    rules_html: null, flavor: text(get('flavor')), artist: null, tags: strings(get('tags')),
    orientation: type === 'Battlefield' ? 'landscape' : 'portrait', image_url: text(get('image')),
  };
}

/** Parse the indexed payload into rows keyed by our stable printing IDs. */
export function parseDotggIndexed(payload: Indexed): DotggRow[] {
  const names = Array.isArray(payload.names) ? payload.names : [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  if (!names.length || !data.length) throw new Error('dotgg: unexpected payload (no names/data)');
  const col = (n: string) => names.indexOf(n);
  const iId = col('id');
  const iName = col('name');
  const iMarket = col('marketIds');
  const iPrice = col('price');
  const iFoil = col('foilPrice');
  const iHasN = col('hasNormal');
  const iHasF = col('hasFoil');
  const iBanned = col('banned');
  const iFlavor = col('flavor');
  if (iId < 0) throw new Error('dotgg: payload has no id column');
  const out: DotggRow[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const raw = String(row[iId] ?? '');
    if (!raw) continue;
    const get = (key: string): unknown => row[col(key)];
    const oversized = /\(oversized\)/i.test(String(get('name') ?? ''));
    const id = normalizeCommunityId(raw + (oversized && !raw.toUpperCase().endsWith('-OVERSIZED') ? '-OVERSIZED' : ''));
    if (!id) continue;
    const flavorRaw = iFlavor >= 0 ? row[iFlavor] : null;
    out.push({
      id,
      dotgg_id: raw,
      name: iName >= 0 && row[iName] ? String(row[iName]) : null,
      card: mapCard(get, id),
      set_name: text(get('set_name')),
      tcgplayer_id: iMarket >= 0 ? firstInt(row[iMarket]) : null,
      has_normal: iHasN >= 0 ? flag(row[iHasN]) : null,
      has_foil: iHasF >= 0 ? flag(row[iHasF]) : null,
      banned: iBanned >= 0 ? flag(row[iBanned]) : null,
      flavor: typeof flavorRaw === 'string' && flavorRaw.trim() ? flavorRaw.trim() : null,
      price: iPrice >= 0 ? money(row[iPrice]) : null,
      foil_price: iFoil >= 0 ? money(row[iFoil]) : null,
    });
  }
  return out;
}

export function parseDotggCatalog(payload: Indexed): CardSourceResult {
  const rows = parseDotggIndexed(payload);
  const cards = new Map<string, SourceCard>();
  const sets = new Map<string, CardSourceResult['sets'][number]>();
  const joined = indexJoinRows(rows);
  for (const row of rows) {
    if (!row.card) continue;
    // Duplicate spellings of the same ID share one printing; prefer the chosen market row.
    if (!cards.has(row.id) || joined.get(row.id)?.tcgplayer_id === row.tcgplayer_id) cards.set(row.id, row.card);
    const code = row.card.set_code;
    if (!sets.has(code)) sets.set(code, { code, name: row.set_name ?? code, printed_total: null, release_date: KNOWN_RELEASE_DATES[code] ?? null });
  }
  if (!cards.size) throw new Error('dotgg: no usable cards');
  const skipped = (payload.data?.length ?? 0) - rows.filter((r) => r.card).length;
  return { source: 'dotgg', cards: [...cards.values()], sets: [...sets.values()], join: [...joined.values()],
    diagnostics: { failed: skipped, warnings: skipped ? [`dotgg: skipped ${skipped} invalid card rows`] : [] } };
}

export async function fetchDotggCatalog(ctx: Pick<JobCtx, 'log' | 'signal'>): Promise<CardSourceResult> {
  const payload = await fetchJson<Indexed>(DOTGG_CARDS_URL, { signal: ctx.signal, timeoutMs: 60000 });
  const result = parseDotggCatalog(payload);
  ctx.log.info(`dotgg catalog: ${result.cards.length} cards / ${result.sets.length} sets`);
  return result;
}

/** Fetch + parse. Throws on network/shape errors (callers decide whether that is fatal). */
export async function fetchDotggCards(ctx: Pick<JobCtx, 'log' | 'signal'>): Promise<DotggRow[]> {
  const payload = await fetchJson<Indexed>(DOTGG_CARDS_URL, { signal: ctx.signal, timeoutMs: 60000 });
  const rows = parseDotggIndexed(payload);
  ctx.log.info(`dotgg: ${rows.length} rows (${rows.filter((r) => r.tcgplayer_id).length} with tcgplayer ids)`);
  return rows;
}

/** Collapse rows to one per our id (prefer the row that carries a tcgplayer id / prices). */
export function indexJoinRows(rows: CardJoinRow[]): Map<string, CardJoinRow> {
  const map = new Map<string, CardJoinRow>();
  for (const r of rows) {
    const prev = map.get(r.id);
    if (!prev) {
      map.set(r.id, r);
      continue;
    }
    const score = (x: CardJoinRow) => (x.tcgplayer_id ? 2 : 0) + (x.price || x.foil_price ? 1 : 0);
    if (score(r) > score(prev)) map.set(r.id, { ...prev, ...r, flavor: r.flavor ?? prev.flavor });
    else if (!prev.flavor && r.flavor) map.set(r.id, { ...prev, flavor: r.flavor });
  }
  return map;
}
