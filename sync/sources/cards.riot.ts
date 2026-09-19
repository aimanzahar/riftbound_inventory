// Riot Publishing Content Service — the official card-gallery feed (undocumented, no auth).
// See docs/sources.md §1.1 for the verified shape.
import type { JobCtx } from '../types.ts';
import type { CardSourceResult, SourceCard, SourceSet } from './types.ts';
import { fetchJson } from '../lib/http.ts';
import { fromRiotId } from '../../shared/ids.ts';

const BASE = 'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list';
export const RIOT_CARDS_URL = `${BASE}/riftbound_gallery_cards`;
export const RIOT_SETS_URL = `${BASE}/riftbound_gallery_sets`;

/** Release dates are not in the feed; hardcode the known ones (null for unknown sets). */
export const KNOWN_RELEASE_DATES: Record<string, string> = {
  OGN: '2025-10-31',
  OGS: '2025-10-31',
  SFD: '2026-02-13',
  UNL: '2026-05-08',
  VEN: '2026-07-31',
  RAD: '2026-10-23',
};

// ---- Riot JSON shapes (only the parts we read) ----
interface LabelValue {
  id?: string | number;
  label?: string;
}
export interface RiotCardItem {
  id: string;
  collectorNumber?: number;
  publicCode?: string;
  name: string;
  set?: { value?: { id?: string; label?: string } };
  cardType?: { type?: LabelValue[]; superType?: LabelValue[] };
  rarity?: { value?: LabelValue };
  domain?: { values?: LabelValue[] };
  cardImage?: { url?: string; dimensions?: { width?: number; height?: number } };
  orientation?: string;
  illustrator?: { values?: LabelValue[] };
  text?: { richText?: { type?: string; body?: string } };
  effect?: { richText?: { type?: string; body?: string } };
  energy?: { value?: LabelValue };
  might?: { value?: LabelValue };
  power?: { value?: LabelValue };
  mightBonus?: { value?: LabelValue };
  tags?: { tags?: string[] };
}
interface RiotList<T> {
  data?: T[];
  metadata?: { totalItems?: number; from?: number; limit?: number };
}
interface RiotSetItem {
  id: string;
  name: string;
  collectorNumberMax?: number;
}

// ---- HTML → plain text ----
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ent.toLowerCase()] ?? m;
  });
}

/** Riot glyph tokens (':rb_energy_2:', ':rb_rune_fury:', ':rb_exhaust:', ':rb_might:') → readable brackets. */
export function replaceGlyphTokens(s: string): string {
  return s.replace(/:rb_([a-z0-9_]+):/g, (_m, tok: string) => {
    const energy = tok.match(/^energy_(\d+)$/);
    if (energy) return `[${energy[1]}]`;
    const rune = tok.match(/^rune_([a-z]+)$/);
    if (rune) return rune[1] === 'rainbow' ? '[Any Rune]' : `[${rune[1][0].toUpperCase()}${rune[1].slice(1)}]`;
    if (tok === 'exhaust') return '[Exhaust]';
    if (tok === 'might') return '[Might]';
    if (tok === 'power') return '[Power]';
    return `[${tok}]`;
  });
}

/** Convert the gallery's rich-text HTML into readable plain text (keeps line breaks, bullets). */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  let s = html.replace(/\r/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p\s*>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<\/li\s*>/gi, '\n');
  s = s.replace(/<\/(ul|ol|div|h\d)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = replaceGlyphTokens(s);
  const lines = s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l, i, arr) => !(l === '' && (i === 0 || arr[i - 1] === '')));
  const out = lines.join('\n').trim();
  return out.length ? out : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

/** Map one gallery item to a SourceCard (null when the id cannot be parsed). */
export function mapRiotItem(item: RiotCardItem): SourceCard | null {
  if (!item || typeof item.id !== 'string' || !item.name) return null;
  const parts = fromRiotId(item.id);
  if (!parts) return null;
  const setCode = (item.set?.value?.id ?? parts.set).toUpperCase();
  const type = item.cardType?.type?.[0]?.label ?? null;
  const supertype = item.cardType?.superType?.[0]?.label ?? null;
  const domains = (item.domain?.values ?? []).map((v) => String(v.id ?? v.label ?? '').toLowerCase()).filter(Boolean);
  // some vanilla cards carry a literal "[NO TEXT]" placeholder in the feed → treat as empty
  const isPlaceholder = (h: string) => /^\s*\[?\s*no text\s*\]?\s*$/i.test(htmlToText(h) ?? '');
  const textHtmlRaw = item.text?.richText?.body ?? '';
  const textHtml = isPlaceholder(textHtmlRaw) ? '' : textHtmlRaw;
  const effectHtmlRaw = item.effect?.richText?.body ?? '';
  const effectHtml = isPlaceholder(effectHtmlRaw) ? '' : effectHtmlRaw;
  const bonus = item.mightBonus?.value?.label ?? (item.mightBonus?.value?.id !== undefined ? `+${item.mightBonus.value.id}` : null);
  const htmlParts: string[] = [];
  if (textHtml) htmlParts.push(textHtml);
  if (bonus) htmlParts.push(`<p>Might bonus: ${String(bonus)}</p>`);
  if (effectHtml) htmlParts.push(effectHtml);
  const rulesHtml = htmlParts.length ? htmlParts.join('') : null;
  const artist = (item.illustrator?.values ?? []).map((v) => v.label).filter((x): x is string => Boolean(x)).join(', ') || null;
  return {
    id: parts.id,
    set_code: setCode,
    number: parts.number,
    number_int: parts.number_int,
    suffix: parts.suffix,
    riot_id: item.id,
    public_code: item.publicCode ?? null,
    name: String(item.name).trim(),
    type: type ?? (supertype === 'Token' ? 'Token' : null),
    supertype,
    domains,
    energy: num(item.energy?.value?.id ?? item.energy?.value?.label),
    might: num(item.might?.value?.id ?? item.might?.value?.label),
    power: num(item.power?.value?.id ?? item.power?.value?.label),
    rarity: item.rarity?.value?.label ?? null,
    rules_text: htmlToText(rulesHtml),
    rules_html: rulesHtml,
    flavor: null,
    artist,
    tags: Array.isArray(item.tags?.tags) ? item.tags!.tags!.map(String) : [],
    orientation: item.orientation === 'landscape' ? 'landscape' : 'portrait',
    image_url: item.cardImage?.url ?? null,
  };
}

export function mapRiotSets(items: RiotSetItem[], cardsPerSet?: Map<string, number>): SourceSet[] {
  const sets: SourceSet[] = items
    .filter((s) => s && typeof s.id === 'string')
    .map((s) => ({
      code: s.id.toUpperCase(),
      name: s.name || s.id.toUpperCase(),
      printed_total: Number.isFinite(Number(s.collectorNumberMax)) ? Number(s.collectorNumberMax) : null,
      release_date: KNOWN_RELEASE_DATES[s.id.toUpperCase()] ?? null,
    }));
  // sets referenced by cards but absent from the sets list (defensive)
  if (cardsPerSet) {
    for (const code of cardsPerSet.keys()) {
      if (!sets.some((s) => s.code === code)) sets.push({ code, name: code, printed_total: null, release_date: KNOWN_RELEASE_DATES[code] ?? null });
    }
  }
  return sets;
}

/** Fetch every gallery page (limit=2000 first; keeps paging while the feed reports more items). */
export async function fetchRiotCards(ctx: Pick<JobCtx, 'log' | 'signal'>): Promise<{ items: RiotCardItem[]; totalItems: number | null }> {
  const seen = new Map<string, RiotCardItem>();
  let from = 0;
  let limit = 2000;
  let totalItems: number | null = null;
  for (let page = 0; page < 40; page++) {
    const url = `${RIOT_CARDS_URL}?locale=en_US&from=${from}&limit=${limit}`;
    const res = await fetchJson<RiotList<RiotCardItem>>(url, { signal: ctx.signal, timeoutMs: 60000 });
    const data = Array.isArray(res.data) ? res.data : [];
    totalItems = Number.isFinite(Number(res.metadata?.totalItems)) ? Number(res.metadata?.totalItems) : totalItems;
    let added = 0;
    for (const it of data) {
      if (it && typeof it.id === 'string' && !seen.has(it.id)) {
        seen.set(it.id, it);
        added++;
      }
    }
    ctx.log.info(`riot cards page from=${from} limit=${limit}: ${data.length} items (${added} new, total ${seen.size}/${totalItems ?? '?'})`);
    if (data.length === 0 || added === 0) break;
    from += data.length;
    if (totalItems !== null && from >= totalItems) break;
    // the server may cap the page size: keep paging with the size it actually returned
    limit = Math.max(200, Math.min(limit, data.length));
  }
  return { items: [...seen.values()], totalItems };
}

export async function fetchRiotSets(ctx: Pick<JobCtx, 'signal'>): Promise<RiotSetItem[]> {
  const res = await fetchJson<RiotList<RiotSetItem>>(`${RIOT_SETS_URL}?locale=en_US&from=0&limit=200`, { signal: ctx.signal });
  return Array.isArray(res.data) ? res.data : [];
}

export async function fetchRiotCatalog(ctx: Pick<JobCtx, 'log' | 'signal' | 'progress'>): Promise<CardSourceResult> {
  ctx.progress(0, 3, 'fetching Riot sets');
  const setItems = await fetchRiotSets(ctx);
  ctx.progress(1, 3, 'fetching Riot cards');
  const { items, totalItems } = await fetchRiotCards(ctx);
  const cards: SourceCard[] = [];
  let unparsed = 0;
  for (const it of items) {
    try {
      const c = mapRiotItem(it);
      if (c) cards.push(c);
      else unparsed++;
    } catch { unparsed++; }
  }
  const perSet = new Map<string, number>();
  for (const c of cards) perSet.set(c.set_code, (perSet.get(c.set_code) ?? 0) + 1);
  const sets = mapRiotSets(setItems, perSet);
  const note = `riot: ${cards.length} cards (feed says ${totalItems ?? '?'}), ${sets.length} sets${unparsed ? `, ${unparsed} unparsed ids` : ''}`;
  ctx.log.info(note);
  const warnings: string[] = [];
  if (unparsed) warnings.push(`riot: skipped ${unparsed} invalid card rows`);
  // Riot currently reports more items than it serves; keep this visible without rejecting valid cards.
  if (totalItems !== null && items.length !== totalItems) warnings.push(`riot: received ${items.length} unique items; metadata reports ${totalItems}`);
  return { source: 'riot', sets, cards, note, diagnostics: { failed: unparsed, warnings } };
}
