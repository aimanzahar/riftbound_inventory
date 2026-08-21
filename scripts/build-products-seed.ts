// Build seed/products.json — the committed, fixed-contents product catalog.
//
//   npm run seed:products            (node scripts/build-products-seed.ts)
//
// Sources (see docs/sources.md §1.5, §3, §3.9):
//   - dotgg deck API        https://api.dotgg.gg/cgfw/getdeck?game=riftbound&slug=<slug>   → {deck:{'OGN-001':'2',…}}
//   - Russeus RB-TCG-Arena  https://raw.githubusercontent.com/Russeus/RB-TCG-Arena/main/Riftbound-Decks.json (Zed Showdown; dotgg's is corrupt)
//   - docs/sources.md §3    verbatim decklists with collector numbers — parsed at runtime and treated as the AUTHORITATIVE cross-check;
//                           hand-entered lists (Spiritforged Pre-Rift kits, Unleashed Diana kit) come from here directly
//   - dotgg sealed catalog  https://api.dotgg.gg/cgfw/getproducts?game=riftbound → 66 SKUs (productId = TCGplayer id)
//   - Riot gallery          every card_id must exist there (fails loudly otherwise); also used to classify legend/rune/battlefield/main
//
// Output contract (consumed by sync/products.ts): Product[] from shared/types.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fetchJson, pooled } from '../sync/lib/http.ts';
import { writeJsonFile } from '../sync/lib/files.ts';
import { fromRiotId, normalizeCommunityId } from '../shared/ids.ts';
import type { Product, ProductContent, ProductKind } from '../shared/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_FILE = path.join(ROOT, 'seed', 'products.json');
const DOCS_FILE = path.join(ROOT, 'docs', 'sources.md');

const GALLERY_URL =
  'https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=en_US&from=0&limit=2000';
const DOTGG_DECK_URL = (slug: string) => `https://api.dotgg.gg/cgfw/getdeck?game=riftbound&slug=${slug}`;
const DOTGG_PRODUCTS_URL = 'https://api.dotgg.gg/cgfw/getproducts?game=riftbound';
const RUSSEUS_URL = 'https://raw.githubusercontent.com/Russeus/RB-TCG-Arena/main/Riftbound-Decks.json';
const TCGPLAYER_URL = (id: number) => `https://www.tcgplayer.com/product/${id}`;

type SetCode = 'OGN' | 'OGS' | 'SFD' | 'UNL' | 'VEN' | null;

/** Basic rune printings we count every precon rune against (OGN basics). */
const RUNE_BY_DOMAIN: Record<string, string> = {
  Fury: 'OGN-007',
  Calm: 'OGN-042',
  Mind: 'OGN-089',
  Body: 'OGN-126',
  Chaos: 'OGN-166',
  Order: 'OGN-214',
};
/** Other rune printings → the OGN basic of the same domain. */
const RUNE_REMAP: Record<string, string> = {
  'VEN-R01': 'OGN-007',
  'VEN-R02': 'OGN-042',
  'VEN-R03': 'OGN-089',
  'VEN-R04': 'OGN-126',
  'VEN-R05': 'OGN-166',
  'VEN-R06': 'OGN-214',
  'VEN-R01a': 'OGN-007',
  'VEN-R02a': 'OGN-042',
  'VEN-R03a': 'OGN-089',
  'VEN-R04a': 'OGN-126',
  'VEN-R05a': 'OGN-166',
  'VEN-R06a': 'OGN-214',
  'OGN-007a': 'OGN-007',
  'OGN-042a': 'OGN-042',
  'OGN-089a': 'OGN-089',
  'OGN-126a': 'OGN-126',
  'OGN-166a': 'OGN-166',
  'OGN-214a': 'OGN-214',
};
const RUNE_NOTE = 'Runes counted as the OGN basic printings (OGN-007/042/089/126/166/214).';

// ---------------------------------------------------------------------------
// Fixed-list product specs
// ---------------------------------------------------------------------------

type Shape = 'deck56' | 'deck54' | 'kit15';
type Source = { type: 'dotgg'; slug: string } | { type: 'russeus'; title: string } | { type: 'doc' };

interface DeckSpec {
  id: string;
  name: string;
  set_code: SetCode;
  kind: ProductKind;
  shape: Shape;
  source: Source;
  /** '<section>/<KEY>' in docs/sources.md §3, e.g. '3.2/JINX' (KEY = first word(s) of the bold heading before ',' '(' or ':'). */
  doc: string;
  /** docs ids to drop from the §3 line (e.g. Diana's Gustwalker). */
  docDrop?: string[];
  /** TCGplayer id when this deck IS a retail SKU (takes release date/image from dotgg getproducts). */
  tcgplayer_id?: number;
  /** Borrow release date + image from this SKU when the deck is not sold on its own. */
  parent_sku?: number;
  msrp_usd?: number;
  source_url: string;
  notes?: string;
}

const RIFTMANA = {
  pg: 'https://riftmana.com/riftbound-proving-grounds-decklists/',
  ogn: 'https://riftmana.com/riftbound-preconstructed-origin-champion-starter-decks/',
  sfd: 'https://riftmana.com/riftbound-preconstructed-spiritforged-champion-starter-decks/',
  unl: 'https://riftmana.com/preconstructed-unleashed-champion-starter-decks-riftbound-tcg/',
  ven: 'https://riftmana.com/preconstructed-vendetta-champion-starter-decks-riftbound-tcg/',
  sfdKits: 'https://riftmana.com/spiritforged-pre-rift-event-rules-6-mini-pre-constructed-decks/',
};
const RIOT_SFD_PRECONS = 'https://playriftbound.com/en-us/news/announcements/spiritforged-precons-fiora-rumble';

const PG_BOX_SKU = 635460;
const SHOWDOWN_SKU = 697971;
const SFD_KIT_SKU = 679041;
const UNL_KIT_SKU = 678898;
const VEN_KIT_SKU = 697969;

const DECKS: DeckSpec[] = [
  // --- Origins: Proving Grounds (4 × 54, sold only as the box set) ---
  ...(
    [
      ['annie', 'Annie, Dark Child'],
      ['lux', 'Lux, Lady of Luminosity'],
      ['garen', 'Garen, Might of Demacia'],
      ['master-yi', 'Master Yi, Wuju Bladesman'],
    ] as const
  ).map<DeckSpec>(([slug, title]) => ({
    id: `ogs-proving-grounds-deck-${slug}`,
    name: `Proving Grounds Deck (${title})`,
    set_code: 'OGS',
    kind: 'starter_set',
    shape: 'deck54',
    source: { type: 'dotgg', slug: `${slug}-proving-grounds-deck` },
    doc: `3.1/${title.split(',')[0].toUpperCase()}`,
    parent_sku: PG_BOX_SKU,
    source_url: DOTGG_DECK_URL(`${slug}-proving-grounds-deck`),
    notes: `One of the four 54-card decks inside the Origins - Proving Grounds Box Set (TCGplayer ${PG_BOX_SKU}); not sold separately.`,
  })),
  // --- Origins Champion Decks ---
  ...(
    [
      ['jinx', 'Jinx', 635371],
      ['viktor', 'Viktor', 635374],
      ['lee-sin', 'Lee Sin', 635375],
    ] as const
  ).map<DeckSpec>(([slug, title, tcg]) => ({
    id: `ogn-champion-deck-${slug}`,
    name: `Origins - Champion Deck (${title})`,
    set_code: 'OGN',
    kind: 'champion_deck',
    shape: 'deck56',
    source: { type: 'dotgg', slug: `${slug}-premade-origins-champion-deck` },
    doc: `3.2/${title.toUpperCase()}`,
    tcgplayer_id: tcg,
    msrp_usd: 19.99,
    source_url: DOTGG_DECK_URL(`${slug}-premade-origins-champion-deck`),
    notes: 'Also contains 1 random Origins booster, paper playmat and deckbox (not in contents).',
  })),
  // --- Spiritforged Champion Decks ---
  ...(
    [
      ['rumble', 'Rumble', 661939],
      ['fiora', 'Fiora', 661942],
    ] as const
  ).map<DeckSpec>(([slug, title, tcg]) => ({
    id: `sfd-champion-deck-${slug}`,
    name: `Spiritforged - Champion Deck (${title})`,
    set_code: 'SFD',
    kind: 'champion_deck',
    shape: 'deck56',
    source: { type: 'dotgg', slug: `${slug}-champion-deck` },
    doc: `3.3/${title.toUpperCase()}`,
    tcgplayer_id: tcg,
    msrp_usd: 19.99,
    source_url: DOTGG_DECK_URL(`${slug}-champion-deck`),
    notes: `Also contains 1 random Spiritforged booster, paper playmat, deckbox and tokens (not in contents). Official list: ${RIOT_SFD_PRECONS}`,
  })),
  // --- Unleashed Champion Decks ---
  ...(
    [
      ['vex', 'Vex', 678155],
      ['vi', 'Vi', 678157],
    ] as const
  ).map<DeckSpec>(([slug, title, tcg]) => ({
    id: `unl-champion-deck-${slug}`,
    name: `Unleashed - Champion Deck (${title})`,
    set_code: 'UNL',
    kind: 'champion_deck',
    shape: 'deck56',
    source: { type: 'dotgg', slug: `${slug}-champion-deck` },
    doc: `3.4/${title.toUpperCase()}`,
    tcgplayer_id: tcg,
    source_url: DOTGG_DECK_URL(`${slug}-champion-deck`),
    notes: 'Also contains 1 random Unleashed booster, paper playmat, deckbox and tokens (not in contents).',
  })),
  // --- Vendetta Showdown Decks (2 × 56 in one SKU) ---
  {
    id: 'ven-showdown-deck-zed',
    name: 'Vendetta - Showdown Deck (Zed)',
    set_code: 'VEN',
    kind: 'showdown_deck',
    shape: 'deck56',
    source: { type: 'russeus', title: 'Zed Champion Deck (Precon)' },
    doc: '3.5/ZED',
    parent_sku: SHOWDOWN_SKU,
    source_url: RUSSEUS_URL,
    notes: `Half of Vendetta - Showdown Decks: Zed vs Shen (TCGplayer ${SHOWDOWN_SKU}); not sold separately. dotgg slug zed-showdown-deck is corrupt (112 cards = Zed+Shen merged), so the list comes from the Russeus RB-TCG-Arena JSON.`,
  },
  {
    id: 'ven-showdown-deck-shen',
    name: 'Vendetta - Showdown Deck (Shen)',
    set_code: 'VEN',
    kind: 'showdown_deck',
    shape: 'deck56',
    source: { type: 'dotgg', slug: 'shen-showdown-deck' },
    doc: '3.5/SHEN',
    parent_sku: SHOWDOWN_SKU,
    source_url: DOTGG_DECK_URL('shen-showdown-deck'),
    notes: `Half of Vendetta - Showdown Decks: Zed vs Shen (TCGplayer ${SHOWDOWN_SKU}); not sold separately.`,
  },
  // --- Spiritforged Pre-Rift kits (hand-entered from docs/sources.md §3.6) ---
  ...(
    [
      ['ezreal', 'Ezreal', 'EZREAL'],
      ['renata-glasc', 'Renata Glasc', 'RENATA GLASC'],
      ['lucian', 'Lucian', 'LUCIAN'],
      ['reksai', "Rek'Sai", "REK'SAI"],
      ['jax', 'Jax', 'JAX'],
      ['irelia', 'Irelia', 'IRELIA'],
    ] as const
  ).map<DeckSpec>(([slug, title, key]) => ({
    id: `sfd-pre-rift-kit-${slug}`,
    name: `Spiritforged - Pre-Rift Kit (${title})`,
    set_code: 'SFD',
    kind: 'prerift_kit',
    shape: 'kit15',
    source: { type: 'doc' },
    doc: `3.6/${key}`,
    parent_sku: SFD_KIT_SKU,
    source_url: RIFTMANA.sfdKits,
    notes: `15-card seeded mini-precon: 1 of 6 varieties in the retail Spiritforged - Pre-Rift Kit (TCGplayer ${SFD_KIT_SKU}), which also has 5 boosters + promo Yone, Blademaster (not in contents). Runes not included in the kit. List hand-entered from riftmana.`,
  })),
  // --- Unleashed Pre-Rift kits ---
  ...(
    [
      ['vi', 'Vi', 'VI'],
      ['jhin', 'Jhin', 'JHIN'],
      ['ivern', 'Ivern', 'IVERN'],
      ['master-yi', 'Master Yi', 'MASTER YI'],
      ['khazix', "Kha'Zix", "KHA'ZIX"],
    ] as const
  ).map<DeckSpec>(([slug, title, key]) => ({
    id: `unl-pre-rift-kit-${slug}`,
    name: `Unleashed - Pre-Rift Kit (${title})`,
    set_code: 'UNL',
    kind: 'prerift_kit',
    shape: 'kit15',
    source: { type: 'dotgg', slug: `unleashed-pre-rift-precon-${slug}` },
    doc: `3.7/${key}`,
    parent_sku: UNL_KIT_SKU,
    source_url: DOTGG_DECK_URL(`unleashed-pre-rift-precon-${slug}`),
    notes: `15-card seeded mini-precon: 1 of 6 varieties in the retail Unleashed - Pre-Rift Kit (TCGplayer ${UNL_KIT_SKU}), which also has 5 boosters + promo Ashe, Focused (not in contents). Runes not included in the kit.`,
  })),
  {
    id: 'unl-pre-rift-kit-diana',
    name: 'Unleashed - Pre-Rift Kit (Diana)',
    set_code: 'UNL',
    kind: 'prerift_kit',
    shape: 'kit15',
    source: { type: 'doc' },
    doc: '3.7/DIANA',
    docDrop: ['UNL-075'],
    parent_sku: UNL_KIT_SKU,
    source_url: DOTGG_DECK_URL('unleashed-pre-rift-precon-diana'),
    notes: `unconfirmed list — sources disagree: dotgg lists 14 cards (no champion), hextechanalytics 16 (adds UNL-079 Diana, Lunari and UNL-075 Gustwalker); this list is dotgg's 14 + UNL-079, Gustwalker dropped. 15-card seeded mini-precon: 1 of 6 varieties in the retail Unleashed - Pre-Rift Kit (TCGplayer ${UNL_KIT_SKU}), which also has 5 boosters + promo Ashe, Focused (not in contents). Runes not included in the kit.`,
  },
  // --- Vendetta Pre-Rift kits (9) ---
  ...(
    [
      ['jayce', 'Jayce', 'JAYCE'],
      ['kennen', 'Kennen', 'KENNEN'],
      ['akali', 'Akali', 'AKALI'],
      ['ambessa', 'Ambessa', 'AMBESSA'],
      ['nasus', 'Nasus', 'NASUS'],
      ['zed', 'Zed', 'ZED'],
      ['shen', 'Shen', 'SHEN'],
      ['renekton', 'Renekton', 'RENEKTON'],
      ['mel', 'Mel', 'MEL'],
    ] as const
  ).map<DeckSpec>(([slug, title, key]) => ({
    id: `ven-pre-rift-kit-${slug}`,
    name: `Vendetta - Pre-Rift Kit (${title})`,
    set_code: 'VEN',
    kind: 'prerift_kit',
    shape: 'kit15',
    source: { type: 'dotgg', slug: `pre-rift-kit-${slug}` },
    doc: `3.8/${key}`,
    parent_sku: VEN_KIT_SKU,
    source_url: DOTGG_DECK_URL(`pre-rift-kit-${slug}`),
    notes: `15-card seeded mini-precon: 1 of 9 varieties in the retail Vendetta - Pre-Rift Kit (TCGplayer ${VEN_KIT_SKU}), which also has 5 boosters + promo Riven, Shattered (not in contents). Runes not included in the kit.`,
  })),
];

/** Products whose contents are the sum of several decks (the actual retail SKU). */
interface CompositeSpec {
  id: string;
  name: string;
  set_code: SetCode;
  kind: ProductKind;
  parts: string[];
  tcgplayer_id: number;
  msrp_usd: number | null;
  source_url: string;
  notes: string;
}
const COMPOSITES: CompositeSpec[] = [
  {
    id: 'ogs-proving-grounds-box-set',
    name: 'Origins - Proving Grounds Box Set',
    set_code: 'OGS',
    kind: 'starter_set',
    parts: ['ogs-proving-grounds-deck-annie', 'ogs-proving-grounds-deck-lux', 'ogs-proving-grounds-deck-garen', 'ogs-proving-grounds-deck-master-yi'],
    tcgplayer_id: PG_BOX_SKU,
    msrp_usd: 39.99,
    source_url: RIFTMANA.pg,
    notes: 'All four 54-card Proving Grounds decks (Annie, Lux, Garen, Master Yi). Also contains 4 oversized battlefields, 4 acrylic champion figures and a how-to-play guide (not in contents).',
  },
  {
    id: 'ven-showdown-decks-zed-vs-shen',
    name: 'Vendetta - Showdown Decks: Zed vs Shen',
    set_code: 'VEN',
    kind: 'showdown_deck',
    parts: ['ven-showdown-deck-zed', 'ven-showdown-deck-shen'],
    tcgplayer_id: SHOWDOWN_SKU,
    msrp_usd: 34.99,
    source_url: RIFTMANA.ven,
    notes: 'Both 56-card decks (Zed + Shen). Also contains 2 random Vendetta boosters, 2 paper playmats, 2 paper deckboxes and tokens (not in contents).',
  },
];

/** Fixed-contents products that are not decks. */
const BULK_RUNES_SKU = 678130;
const EXTRA_FIXED: Array<Omit<Product, 'release_date' | 'image_url'> & { tcgplayer_id: number }> = [
  {
    id: 'riftbound-bulk-runes',
    name: 'Riftbound Bulk Runes',
    set_code: null,
    kind: 'bundle',
    msrp_usd: 19.99,
    tcgplayer_id: BULK_RUNES_SKU,
    source_url: TCGPLAYER_URL(BULK_RUNES_SKU),
    fixed_contents: 1,
    notes: `324 basic runes, 54 of each domain (UVS RB-01RS01-EN). Printing assumed to be the OGN basics. ${RUNE_NOTE}`,
    contents: Object.values(RUNE_BY_DOMAIN).map((card_id) => ({ card_id, finish: 'normal' as const, qty: 54 })),
  },
];

/** MSRPs documented in docs/sources.md for sealed SKUs (TCGplayer id → USD). */
const SEALED_MSRP: Record<number, number> = {
  661934: 120, // Spiritforged Booster Display (UVS RB-02BD01-EN)
  693380: 119.99, // Vendetta Booster Display
  658333: 99.99, // Worlds Bundle 2025
  655495: 69.99, // Arcane Box Set
  710238: 70, // Secret Garden Box
  678690: 480, // Spiritforged Pre-Rift Event Kit
};
/** Extra notes for sealed SKUs. */
const SEALED_NOTES: Record<number, string> = {
  706237: 'Display of 4 × Showdown Decks: Zed vs Shen.',
  663920: 'Case of 6 × Proving Grounds Box Set.',
  679041: 'Retail kit: 1 random 15-card mini-precon (6 varieties, see the per-champion Pre-Rift Kit products) + 5 boosters + promo.',
  678898: 'Retail kit: 1 random 15-card mini-precon (6 varieties, see the per-champion Pre-Rift Kit products) + 5 boosters + promo.',
  697969: 'Retail kit: 1 random 15-card mini-precon (9 varieties, see the per-champion Pre-Rift Kit products) + 5 boosters + promo.',
  678690: 'Event kit: 16 Pre-Rift kits + 1 booster display.',
  678159: 'Event kit: 16 Pre-Rift kits + 1 booster display.',
  707963: 'Event kit: 16 Pre-Rift kits + 1 booster display.',
  678162: '6 boosters + 36 basic runes (6 each) + 3 double-sided full-art tokens; boosters are random so contents are not fixed.',
  697970: '6 boosters + 36 basic runes (6 each) + 3 double-sided full-art tokens; boosters are random so contents are not fixed.',
  711372: '6 boosters + 36 basic runes (6 each) + 3 foil promo tokens; boosters are random so contents are not fixed.',
  655495: '6 foil Arcane-art champions (Jinx, Vi, Heimerdinger, Caitlyn, Viktor, Warwick) + display case; these printings are not in the Riot gallery yet, so contents are not listed.',
  658333: 'Foil playmat, deckbox, sleeves, Panda Teemo promo, 3 oversized battlefields; promo printings not in the Riot gallery.',
  710238: '3 alt-art cards (Ivern, Lillia, Ultrasoft Poro) + 5 alt-art tokens + 3 Unleashed boosters; SGN printings not in the Riot gallery.',
  678131: 'Case of Riftbound Bulk Runes boxes.',
};

// ---------------------------------------------------------------------------
// Riot gallery → card index
// ---------------------------------------------------------------------------

interface GalleryCard {
  id: string;
  name: string;
  cardType?: { type?: Array<{ id: string }>; superType?: Array<{ id: string }> };
}
interface CardInfo {
  id: string;
  name: string;
  type: string;
  supertype: string;
}

async function loadGallery(): Promise<Map<string, CardInfo>> {
  const g = await fetchJson<{ data: GalleryCard[]; metadata?: { totalItems?: number } }>(GALLERY_URL, { timeoutMs: 60000 });
  const map = new Map<string, CardInfo>();
  for (const c of g.data) {
    const p = fromRiotId(c.id);
    if (!p) throw new Error(`Cannot parse Riot gallery id ${c.id}`);
    map.set(p.id, {
      id: p.id,
      name: c.name,
      type: c.cardType?.type?.[0]?.id ?? '',
      supertype: c.cardType?.superType?.[0]?.id ?? '',
    });
  }
  console.log(`gallery: ${g.data.length} cards (${map.size} ids; metadata.totalItems=${g.metadata?.totalItems ?? '?'})`);
  return map;
}

// ---------------------------------------------------------------------------
// Content list helpers (Map<card_id, qty>)
// ---------------------------------------------------------------------------

type Counts = Map<string, number>;

function add(m: Counts, id: string, qty: number): void {
  m.set(id, (m.get(id) ?? 0) + qty);
}

/** Normalise a community id and map non-basic rune printings to the OGN basics. Returns [id, remapped?]. */
function normalizeId(raw: string): { id: string; remapped: string | null } {
  const id = normalizeCommunityId(raw);
  if (!id) throw new Error(`Unparseable/promo card id "${raw}"`);
  const basic = RUNE_REMAP[id];
  return basic ? { id: basic, remapped: `${id}→${basic}` } : { id, remapped: null };
}

function fromIdMap(raw: Record<string, string | number>): { counts: Counts; remapped: string[] } {
  const counts: Counts = new Map();
  const remapped: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    const { id, remapped: r } = normalizeId(k);
    if (r) remapped.push(r);
    add(counts, id, Number(v));
  }
  return { counts, remapped };
}

function sameCounts(a: Counts, b: Counts): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function diffCounts(primary: Counts, doc: Counts): string[] {
  const ids = new Set([...primary.keys(), ...doc.keys()]);
  const out: string[] = [];
  for (const id of [...ids].sort()) {
    const p = primary.get(id) ?? 0;
    const d = doc.get(id) ?? 0;
    if (p !== d) out.push(`${id}: source ${p} vs §3 ${d}`);
  }
  return out;
}

function toContents(counts: Counts): ProductContent[] {
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([card_id, qty]) => ({ card_id, finish: 'normal' as const, qty }));
}

// ---------------------------------------------------------------------------
// docs/sources.md §3 parser
// ---------------------------------------------------------------------------

interface DocDeck {
  section: string; // '3.1'
  key: string; // 'ANNIE', 'LEE SIN', "KHA'ZIX"
  heading: string; // full bold text
  line: string;
}

function parseDocs(md: string): DocDeck[] {
  const lines = md.split(/\r?\n/);
  const out: DocDeck[] = [];
  let section: string | null = null;
  let inSection3 = false;
  for (const line of lines) {
    const h2 = line.match(/^## (\d+)\./);
    if (h2) inSection3 = h2[1] === '3';
    if (!inSection3) continue;
    const h3 = line.match(/^### (3\.\d+)\b/);
    if (h3) {
      section = h3[1];
      continue;
    }
    const bullet = line.match(/^- \*\*([^*]+)\*\*(.*)$/);
    if (!bullet || !section) continue;
    const heading = bullet[1].replace(/:\s*$/, '').trim();
    const key = heading.split(/[,(:]/)[0].trim().toUpperCase();
    out.push({ section, key, heading, line: bullet[2] });
  }
  return out;
}

const DOMAIN_RE = /(\d+)x\s+(Fury|Calm|Mind|Body|Chaos|Order)\b/g;
const QTY_ID_RE = /(\d+)x\s+([A-Z]{2,4}-(?:T|R|SP)?\d{1,3}[a-z]?)\b/g;
const BARE_ID_RE = /\b([A-Z]{2,4}-\d{3})\b/g;

/** Counts from a §3 bullet line. Decks use 'Nx SET-NNN' tokens (+ 'Nx Domain' runes); kits are bare ids, all 1x. */
function docCounts(d: DocDeck, shape: Shape, drop: string[] = []): Counts {
  const counts: Counts = new Map();
  if (shape === 'kit15') {
    for (const m of d.line.matchAll(BARE_ID_RE)) {
      const { id } = normalizeId(m[1]);
      if (drop.includes(id)) continue;
      if (counts.has(id)) throw new Error(`§${d.section} ${d.key}: duplicate id ${id} in kit list`);
      add(counts, id, 1);
    }
    return counts;
  }
  for (const m of d.line.matchAll(QTY_ID_RE)) add(counts, normalizeId(m[2]).id, Number(m[1]));
  for (const m of d.line.matchAll(DOMAIN_RE)) add(counts, RUNE_BY_DOMAIN[m[2]], Number(m[1]));
  return counts;
}

function findDoc(docs: DocDeck[], ref: string): DocDeck {
  const [section, key] = ref.split('/');
  const hits = docs.filter((d) => d.section === section && d.key === key);
  if (hits.length !== 1) throw new Error(`docs/sources.md §${section}: expected exactly one deck "${key}", found ${hits.length}`);
  return hits[0];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface Summary {
  total: number;
  distinct: number;
  legend: number;
  champion: number;
  main: number;
  runes: number;
  battlefields: number;
  tokens: number;
  unknown: string[];
}

function summarize(counts: Counts, cards: Map<string, CardInfo>): Summary {
  const s: Summary = { total: 0, distinct: counts.size, legend: 0, champion: 0, main: 0, runes: 0, battlefields: 0, tokens: 0, unknown: [] };
  for (const [id, qty] of counts) {
    s.total += qty;
    const c = cards.get(id);
    if (!c) {
      s.unknown.push(id);
      continue;
    }
    if (c.supertype === 'token') s.tokens += qty;
    else if (c.type === 'legend') s.legend += qty;
    else if (c.type === 'rune') s.runes += qty;
    else if (c.type === 'battlefield') s.battlefields += qty;
    else {
      s.main += qty;
      if (c.supertype === 'champion') s.champion += qty;
    }
  }
  return s;
}

const EXPECT: Record<Shape, Partial<Summary>> = {
  deck56: { total: 56, legend: 1, main: 40, runes: 12, battlefields: 3, tokens: 0 },
  deck54: { total: 54, legend: 1, main: 40, runes: 12, battlefields: 1, tokens: 0 },
  kit15: { total: 15, distinct: 15, legend: 1, main: 13, runes: 0, battlefields: 1, tokens: 0 },
};

function check(s: Summary, expect: Partial<Summary>): string[] {
  const errs: string[] = [];
  for (const [k, v] of Object.entries(expect) as Array<[keyof Summary, number]>) {
    if (s[k] !== v) errs.push(`${k}=${String(s[k])} (want ${v})`);
  }
  if (s.unknown.length) errs.push(`unknown ids: ${s.unknown.join(', ')}`);
  return errs;
}

// ---------------------------------------------------------------------------
// dotgg sealed catalog
// ---------------------------------------------------------------------------

interface DotggProduct {
  productId: string;
  productName: string;
  setName: string;
  releaseDate: string | null;
  description?: string | null;
  image?: string | null;
  sku?: string | null;
}

const SET_BY_NAME: Record<string, SetCode> = {
  Origins: 'OGN',
  'Origins: Proving Grounds': 'OGS',
  Spiritforged: 'SFD',
  Unleashed: 'UNL',
  Vendetta: 'VEN',
};
const PREFIX_BY_NAME: Record<string, string> = { ...Object.fromEntries(Object.entries(SET_BY_NAME).map(([k, v]) => [k, String(v).toLowerCase()])), Radiance: 'rad' };

function epochToDate(s: string | null | undefined): string | null {
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable slug: '<set>-<name>' for "<Set> - <Name>" SKUs ('ogs' for Proving Grounds), else the slugified name. */
function sealedId(p: DotggProduct): string {
  const m = p.productName.match(/^([A-Za-z: ]+?) - (.+)$/);
  if (m && PREFIX_BY_NAME[m[1]]) {
    const prefix = /proving grounds/i.test(m[2]) ? 'ogs' : PREFIX_BY_NAME[m[1]];
    return `${prefix}-${slugify(m[2])}`;
  }
  return slugify(p.productName.replace(/^Riftbound: League of Legends\s+/i, ''));
}

function sealedKind(name: string): ProductKind {
  if (/champion deck/i.test(name)) return 'champion_deck';
  if (/showdown deck/i.test(name)) return 'showdown_deck';
  if (/pre-rift/i.test(name)) return 'prerift_kit';
  if (/proving grounds/i.test(name)) return 'starter_set';
  if (/bundle|bulk runes|box set|secret garden/i.test(name)) return 'bundle';
  if (/booster display|display case/i.test(name)) return 'booster_box';
  if (/booster pack|promo pack/i.test(name)) return 'booster_pack';
  return 'other';
}

function sealedSet(p: DotggProduct): SetCode {
  if (/proving grounds/i.test(p.productName)) return 'OGS';
  if (/^Riftbound Bulk Runes/i.test(p.productName)) return null;
  return SET_BY_NAME[p.setName] ?? null;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const SET_ORDER: Array<string | null> = ['OGN', 'OGS', 'SFD', 'UNL', 'VEN', null];
const KIND_ORDER: ProductKind[] = ['starter_set', 'champion_deck', 'showdown_deck', 'prerift_kit', 'booster_pack', 'booster_box', 'bundle', 'other'];

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('fetching Riot gallery, dotgg products, Russeus decks…');
  const [cards, dotggProducts, russeus] = await Promise.all([
    loadGallery(),
    fetchJson<DotggProduct[]>(DOTGG_PRODUCTS_URL),
    fetchJson<Array<{ title: string; deckList: Record<string, unknown> }>>(RUSSEUS_URL),
  ]);
  console.log(`dotgg getproducts: ${dotggProducts.length} SKUs; Russeus: ${russeus.length} decks`);
  const skuById = new Map<number, DotggProduct>(dotggProducts.map((p) => [Number(p.productId), p]));

  const docs = parseDocs(fs.readFileSync(DOCS_FILE, 'utf8'));
  console.log(`docs/sources.md §3: ${docs.length} deck lines parsed`);

  // dotgg decks (polite: 2 concurrent, 300 ms spacing → ≤ 4 req/s)
  const slugs = DECKS.flatMap((d) => (d.source.type === 'dotgg' ? [d.source.slug] : []));
  const dotggDecks = new Map<string, Record<string, string>>();
  await pooled(slugs, 2, 300, async (slug) => {
    const j = await fetchJson<{ deck?: Record<string, string>; slug?: string }>(DOTGG_DECK_URL(slug));
    if (!j.deck || typeof j.deck !== 'object') throw new Error(`dotgg ${slug}: no deck object (${JSON.stringify(j).slice(0, 120)})`);
    dotggDecks.set(slug, j.deck);
  });
  console.log(`dotgg getdeck: ${dotggDecks.size}/${slugs.length} decks fetched in ${Date.now() - t0} ms\n`);

  const products: Product[] = [];
  const byId = new Map<string, { product: Product; counts: Counts }>();
  const failures: string[] = [];
  const rows: string[][] = [];

  // --- fixed-list decks ---
  for (const spec of DECKS) {
    const doc = findDoc(docs, spec.doc);
    const docList = docCounts(doc, spec.shape, spec.docDrop);
    let counts: Counts;
    let srcLabel: string;
    const notes: string[] = [];
    if (spec.notes) notes.push(spec.notes);
    let remapped: string[] = [];

    if (spec.source.type === 'dotgg') {
      const raw = dotggDecks.get(spec.source.slug);
      if (!raw) throw new Error(`missing dotgg deck ${spec.source.slug}`);
      ({ counts, remapped } = fromIdMap(raw));
      srcLabel = 'dotgg';
    } else if (spec.source.type === 'russeus') {
      const title = spec.source.title;
      const deck = russeus.find((d) => d.title === title);
      if (!deck) throw new Error(`Russeus JSON has no deck titled "${title}"`);
      const raw: Record<string, number> = {};
      for (const [cat, items] of Object.entries(deck.deckList)) {
        if (cat === 'categoriesOrder' || cat === 'Sideboard' || !Array.isArray(items)) continue;
        for (const it of items as Array<{ id: string; count: number }>) raw[it.id] = (raw[it.id] ?? 0) + it.count;
      }
      ({ counts, remapped } = fromIdMap(raw));
      srcLabel = 'russeus';
    } else {
      counts = docList;
      srcLabel = '§' + doc.section;
    }
    if (remapped.length) notes.push(`Rune printings remapped to OGN basics: ${[...new Set(remapped)].join(', ')}.`);

    let crossCheck = 'matches §' + doc.section;
    if (spec.source.type !== 'doc') {
      if (!sameCounts(counts, docList)) {
        const diffs = diffCounts(counts, docList);
        crossCheck = `DIFFERS from §${doc.section} → §3 used (${diffs.length} diffs)`;
        notes.push(`${srcLabel} list differed from docs/sources.md §${doc.section} (${diffs.join('; ')}); §3 list used.`);
        console.warn(`  ! ${spec.id}: ${crossCheck}\n    ${diffs.join('\n    ')}`);
        counts = docList;
        srcLabel += '→§3';
      }
    }
    if (spec.shape !== 'kit15') notes.push(RUNE_NOTE);

    const s = summarize(counts, cards);
    const errs = check(s, EXPECT[spec.shape]);
    if (errs.length) failures.push(`${spec.id}: ${errs.join(', ')}`);

    const sku = skuById.get(spec.tcgplayer_id ?? spec.parent_sku ?? -1);
    const product: Product = {
      id: spec.id,
      name: spec.name,
      set_code: spec.set_code,
      kind: spec.kind,
      release_date: epochToDate(sku?.releaseDate),
      msrp_usd: spec.msrp_usd ?? null,
      tcgplayer_id: spec.tcgplayer_id ?? null,
      image_url: sku?.image ?? null,
      source_url: spec.source_url,
      fixed_contents: 1,
      notes: notes.join(' ') || null,
      contents: toContents(counts),
    };
    products.push(product);
    byId.set(spec.id, { product, counts });
    rows.push([spec.id, String(s.total), String(s.legend), String(s.champion), String(s.main), String(s.runes), String(s.battlefields), srcLabel, errs.length ? 'FAIL: ' + errs.join(', ') : crossCheck]);
  }

  // --- composites (box set / showdown pair) ---
  for (const c of COMPOSITES) {
    const counts: Counts = new Map();
    let expectedTotal = 0;
    for (const part of c.parts) {
      const p = byId.get(part);
      if (!p) throw new Error(`composite ${c.id}: unknown part ${part}`);
      for (const [id, q] of p.counts) add(counts, id, q);
      expectedTotal += [...p.counts.values()].reduce((a, b) => a + b, 0);
    }
    const s = summarize(counts, cards);
    const errs = check(s, { total: expectedTotal, legend: c.parts.length, runes: 12 * c.parts.length, tokens: 0 });
    if (errs.length) failures.push(`${c.id}: ${errs.join(', ')}`);
    const sku = skuById.get(c.tcgplayer_id);
    if (!sku) throw new Error(`composite ${c.id}: TCGplayer ${c.tcgplayer_id} not in dotgg getproducts`);
    const product: Product = {
      id: c.id,
      name: c.name,
      set_code: c.set_code,
      kind: c.kind,
      release_date: epochToDate(sku.releaseDate),
      msrp_usd: c.msrp_usd,
      tcgplayer_id: c.tcgplayer_id,
      image_url: sku.image ?? null,
      source_url: c.source_url,
      fixed_contents: 1,
      notes: `${c.notes} ${RUNE_NOTE}`,
      contents: toContents(counts),
    };
    products.push(product);
    byId.set(c.id, { product, counts });
    rows.push([c.id, String(s.total), String(s.legend), String(s.champion), String(s.main), String(s.runes), String(s.battlefields), `sum(${c.parts.length})`, errs.length ? 'FAIL: ' + errs.join(', ') : 'ok']);
  }

  // --- other fixed products ---
  for (const e of EXTRA_FIXED) {
    const sku = skuById.get(e.tcgplayer_id);
    if (!sku) throw new Error(`${e.id}: TCGplayer ${e.tcgplayer_id} not in dotgg getproducts`);
    const counts: Counts = new Map(e.contents.map((x) => [x.card_id, x.qty]));
    const s = summarize(counts, cards);
    const errs = check(s, { runes: s.total, legend: 0, main: 0, battlefields: 0 });
    if (errs.length) failures.push(`${e.id}: ${errs.join(', ')}`);
    const product: Product = { ...e, release_date: epochToDate(sku.releaseDate), image_url: sku.image ?? null, contents: toContents(counts) };
    products.push(product);
    byId.set(e.id, { product, counts });
    rows.push([e.id, String(s.total), String(s.legend), String(s.champion), String(s.main), String(s.runes), String(s.battlefields), 'manual', errs.length ? 'FAIL: ' + errs.join(', ') : 'ok']);
  }

  // --- sealed SKUs (fixed_contents = 0) ---
  const usedSkus = new Set(products.map((p) => p.tcgplayer_id).filter((x): x is number => x != null));
  let sealedCount = 0;
  const kindTally: Record<string, number> = {};
  for (const p of dotggProducts) {
    const tcg = Number(p.productId);
    if (usedSkus.has(tcg)) continue;
    const id = sealedId(p);
    if (byId.has(id)) throw new Error(`sealed SKU id collision: ${id} (TCGplayer ${tcg})`);
    const kind = sealedKind(p.productName);
    const setNote = SET_BY_NAME[p.setName] === undefined && p.setName ? `Set/group: ${p.setName}.` : '';
    const notes = [SEALED_NOTES[tcg], setNote].filter(Boolean).join(' ');
    const product: Product = {
      id,
      name: p.productName,
      set_code: sealedSet(p),
      kind,
      release_date: epochToDate(p.releaseDate),
      msrp_usd: SEALED_MSRP[tcg] ?? null,
      tcgplayer_id: tcg,
      image_url: p.image ?? null,
      source_url: TCGPLAYER_URL(tcg),
      fixed_contents: 0,
      notes: notes || null,
      contents: [],
    };
    products.push(product);
    byId.set(id, { product, counts: new Map() });
    sealedCount++;
    kindTally[kind] = (kindTally[kind] ?? 0) + 1;
  }

  // --- final id validation across everything ---
  for (const p of products) {
    for (const c of p.contents) {
      if (!cards.has(c.card_id)) failures.push(`${p.id}: card ${c.card_id} not in Riot gallery`);
      if (!(c.qty > 0)) failures.push(`${p.id}: bad qty for ${c.card_id}`);
    }
    const dup = new Set<string>();
    for (const c of p.contents) {
      const k = `${c.card_id}:${c.finish}`;
      if (dup.has(k)) failures.push(`${p.id}: duplicate content row ${k}`);
      dup.add(k);
    }
  }
  const ids = new Set<string>();
  for (const p of products) {
    if (ids.has(p.id)) failures.push(`duplicate product id ${p.id}`);
    ids.add(p.id);
  }

  // --- report ---
  const header = ['product', 'total', 'L', 'champ', 'main', 'runes', 'BF', 'source', 'check'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(fmt(r));
  console.log(`\nfixed-list products: ${rows.length}; sealed SKUs (fixed_contents=0): ${sealedCount} ${JSON.stringify(kindTally)}`);

  if (failures.length) {
    console.error(`\n${failures.length} validation failure(s):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  products.sort((a, b) => {
    const sa = SET_ORDER.indexOf(a.set_code);
    const sb = SET_ORDER.indexOf(b.set_code);
    if (sa !== sb) return sa - sb;
    const ka = KIND_ORDER.indexOf(a.kind);
    const kb = KIND_ORDER.indexOf(b.kind);
    if (ka !== kb) return ka - kb;
    if (a.fixed_contents !== b.fixed_contents) return b.fixed_contents - a.fixed_contents;
    return a.name.localeCompare(b.name);
  });
  writeJsonFile(OUT_FILE, products);
  const totalCards = products.reduce((n, p) => n + p.contents.reduce((m, c) => m + c.qty, 0), 0);
  console.log(`\nwrote ${path.relative(ROOT, OUT_FILE)}: ${products.length} products (${products.filter((p) => p.fixed_contents).length} fixed, ${totalCards} cards listed) in ${Date.now() - t0} ms`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exitCode = 1;
});
