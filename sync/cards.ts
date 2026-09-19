// Job: cards — Riot + DotGG (or a local JSON) → all sets and printings, finishes and market IDs,
// variant_of / variant_kind computation, single-transaction upsert, catalog change row.
import type { JobCtx, JobResult } from './types.ts';
import type { CardJoinRow, CardSourceResult, SourceCard, SourceSet } from './sources/types.ts';
import { fetchCombinedCatalog } from './sources/cards.catalog.ts';
import { indexJoinRows } from './sources/cards.dotgg.ts';
import { loadLocalCards } from './sources/cards.localjson.ts';
import { all, bumpCatalogVersion, nowIso, one, run as sqlRun } from '../server/db/open.ts';
import { insertChange } from '../server/services/changes.ts';
import type { CatalogPayload } from '../shared/types.ts';

interface CardRowDb {
  id: string;
  set_code: string;
  number: string;
  number_int: number;
  riot_id: string | null;
  public_code: string | null;
  name: string;
  type: string | null;
  supertype: string | null;
  domains: string;
  energy: number | null;
  might: number | null;
  power: number | null;
  rarity: string | null;
  rules_text: string | null;
  rules_html: string | null;
  flavor: string | null;
  artist: string | null;
  tags: string;
  orientation: string;
  image_url: string | null;
  variant_of: string | null;
  variant_kind: string | null;
  has_foil: number;
  has_normal: number;
  tcgplayer_id: number | null;
  banned: number;
  active: number;
}

interface SetRowDb {
  code: string;
  name: string;
  release_date: string | null;
  card_count: number | null;
  printed_total: number | null;
  sort_order: number;
}

/** Catalog columns we own (never inventory/tips). Order matters for the upsert statement. */
const CARD_COLS = [
  'set_code', 'number', 'number_int', 'riot_id', 'public_code', 'name', 'type', 'supertype', 'domains', 'energy', 'might', 'power', 'rarity',
  'rules_text', 'rules_html', 'flavor', 'artist', 'tags', 'orientation', 'image_url', 'variant_of', 'variant_kind', 'has_foil', 'has_normal',
  'tcgplayer_id', 'banned', 'active',
] as const;
type CardCol = (typeof CARD_COLS)[number];
type CardValues = Record<CardCol, unknown>;

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface VariantCandidate {
  id: string;
  name: string;
  type: string | null;
  set_code: string;
  number_int: number;
  suffix: string;
  rarity: string | null;
  canonical_name?: string;
  printing_kind?: string | null;
}

/**
 * Group by normalised name + type; the canonical printing is the earliest by (set sort, number_int, suffix).
 * Prefer regular cards over promos as canonicals; keep promo labels even on singletons.
 */
export function computeVariants(
  cands: VariantCandidate[],
  setOrder: Map<string, number>,
  printedTotal: Map<string, number | null>,
): Map<string, { variant_of: string | null; variant_kind: string | null }> {
  const groups = new Map<string, VariantCandidate[]>();
  for (const c of cands) {
    const key = `${normalizeName(c.canonical_name ?? c.name)}|${(c.type ?? '').toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  const out = new Map<string, { variant_of: string | null; variant_kind: string | null }>();
  const rank = (c: VariantCandidate) => setOrder.get(c.set_code) ?? 9999;
  for (const g of groups.values()) {
    const special = (c: VariantCandidate) => c.printing_kind === 'promo' || c.printing_kind === 'oversized' ? 1 : 0;
    g.sort((a, b) => special(a) - special(b) || rank(a) - rank(b) || a.number_int - b.number_int || a.suffix.localeCompare(b.suffix) || a.id.localeCompare(b.id));
    const canon = g[0];
    out.set(canon.id, { variant_of: null, variant_kind: canon.printing_kind ?? null });
    for (const c of g.slice(1)) {
      let kind: string;
      const total = printedTotal.get(c.set_code) ?? null;
      if (c.printing_kind) kind = c.printing_kind;
      else if (c.suffix === 's' && c.type !== 'Token') kind = 'signature';
      else if (c.suffix === 'a' || c.suffix === 'b') kind = (c.rarity ?? '').toLowerCase() === 'showcase' ? 'showcase' : 'alt_art';
      else if (total !== null && c.number_int > total) kind = 'overnumbered';
      else if (c.set_code !== canon.set_code) kind = 'reprint';
      else kind = 'alt_art';
      out.set(c.id, { variant_of: canon.id, variant_kind: kind });
    }
  }
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setsOrdered(sets: SourceSet[]): SourceSet[] {
  return [...sets].sort((a, b) => {
    const da = a.release_date ?? '9999-99-99';
    const db = b.release_date ?? '9999-99-99';
    return da.localeCompare(db) || a.code.localeCompare(b.code);
  });
}

export async function run(ctx: JobCtx): Promise<JobResult> {
  const { db, cfg, log } = ctx;
  const sourceName = typeof ctx.flags.source === 'string' ? ctx.flags.source : cfg.cardSource || 'riot';

  // 1) catalog source
  let src: CardSourceResult;
  if (sourceName === 'localjson') src = await loadLocalCards(ctx);
  else if (sourceName === 'riot') src = await fetchCombinedCatalog(ctx);
  else throw new Error(`unknown card source "${sourceName}" (expected riot|localjson)`);
  if (!src.cards.length) throw new Error(`${src.source} returned no cards — nothing written`);

  // 2) join (DotGG) — failure is non-fatal
  const join: Map<string, CardJoinRow> | null = src.join ? indexJoinRows(src.join) : null;
  const joinNote = src.diagnostics?.warnings.join(' · ') ?? '';
  const failed = src.diagnostics?.failed ?? 0;

  // 3) sets
  const knownSets = all<SetRowDb>(db, 'SELECT code, name, release_date, card_count, printed_total, sort_order FROM sets');
  const mergedSets = new Map<string, SourceSet>(knownSets.map((s) => [s.code, s]));
  for (const s of src.sets) {
    const prev = mergedSets.get(s.code);
    mergedSets.set(s.code, { ...s, name: !src.source.includes('riot') && sourceName === 'riot' && prev ? prev.name : s.name,
      release_date: s.release_date ?? prev?.release_date ?? null, printed_total: s.printed_total ?? prev?.printed_total ?? null });
  }
  const sets = setsOrdered([...mergedSets.values()]);
  const setOrder = new Map<string, number>();
  const printedTotal = new Map<string, number | null>();
  sets.forEach((s, i) => {
    setOrder.set(s.code, i + 1);
    printedTotal.set(s.code, s.printed_total);
  });
  // de-dupe feed by id (defensive)
  const feed = new Map<string, SourceCard>();
  for (const c of src.cards) if (!feed.has(c.id)) feed.set(c.id, c);

  const perSet = new Map<string, number>();
  const activeSets = new Map(all<{ id: string; set_code: string }>(db, 'SELECT id, set_code FROM cards WHERE active=1').map((c) => [c.id, c.set_code]));
  for (const c of feed.values()) activeSets.set(c.id, c.set_code);
  for (const code of activeSets.values()) perSet.set(code, (perSet.get(code) ?? 0) + 1);
  const now = nowIso();
  const stats = { sets: 0, added: 0, updated: 0, deactivated: 0, unchanged: 0, joined: 0, total: feed.size };

  db.tx(() => {
    db.raw.exec('PRAGMA defer_foreign_keys = ON'); // variant_of may point at a row inserted later in this tx

    // existing rows
    const existingSets = new Map(all<SetRowDb>(db, 'SELECT code, name, release_date, card_count, printed_total, sort_order FROM sets').map((s) => [s.code, s]));
    const existing = new Map(all<CardRowDb>(db, `SELECT ${['id', ...CARD_COLS].join(', ')} FROM cards`).map((r) => [r.id, r]));

    // sets upsert
    const upSet = db.raw.prepare(
      `INSERT INTO sets(code, name, release_date, card_count, printed_total, sort_order, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET name=excluded.name, release_date=excluded.release_date, card_count=excluded.card_count,
         printed_total=excluded.printed_total, sort_order=excluded.sort_order, updated_at=excluded.updated_at`,
    );
    sets.forEach((s, i) => {
      const next = {
        name: s.name,
        release_date: s.release_date ?? existingSets.get(s.code)?.release_date ?? null,
        card_count: perSet.get(s.code) ?? existingSets.get(s.code)?.card_count ?? null,
        printed_total: s.printed_total ?? existingSets.get(s.code)?.printed_total ?? null,
        sort_order: i + 1,
      };
      const prev = existingSets.get(s.code);
      const prevCmp = prev ? { name: prev.name, release_date: prev.release_date, card_count: prev.card_count === null ? null : Number(prev.card_count), printed_total: prev.printed_total === null ? null : Number(prev.printed_total), sort_order: Number(prev.sort_order) } : null;
      if (!prevCmp || !sameJson(prevCmp, next)) {
        upSet.run(s.code, next.name, next.release_date, next.card_count, next.printed_total, next.sort_order, now);
        stats.sets++;
      }
    });
    // sets referenced by cards but missing from the source list AND the db (FK safety)
    for (const code of perSet.keys()) {
      if (!setOrder.has(code) && !existingSets.has(code)) {
        upSet.run(code, code, null, perSet.get(code) ?? null, null, 999, now);
        setOrder.set(code, 999);
        stats.sets++;
      }
    }

    // Include retained cards when computing relationships, even during a source outage.
    const cands: VariantCandidate[] = [];
    for (const c of feed.values()) {
      const prev = existing.get(c.id);
      const canonical_name = c.canonical_name ?? (prev?.variant_of ? existing.get(prev.variant_of)?.name : undefined);
      cands.push({ ...c, canonical_name, printing_kind: c.printing_kind ?? (prev?.variant_kind === 'promo' || prev?.variant_kind === 'oversized' ? prev.variant_kind : null) });
    }
    for (const r of existing.values()) {
      if (Number(r.active) === 1 && !feed.has(r.id)) {
        const suffix = (r.number.match(/[a-z]$/) ?? [''])[0];
        const canonical_name = r.variant_of ? existing.get(r.variant_of)?.name : undefined;
        cands.push({ id: r.id, name: r.name, canonical_name, type: r.type, set_code: r.set_code, number_int: Number(r.number_int), suffix, rarity: r.rarity,
          printing_kind: r.variant_kind === 'promo' || r.variant_kind === 'oversized' ? r.variant_kind : null });
      }
    }
    const variants = computeVariants(cands, setOrder, printedTotal);

    // cards upsert
    const upCard = db.raw.prepare(
      `INSERT INTO cards(id, ${CARD_COLS.join(', ')}, updated_at) VALUES (${new Array(CARD_COLS.length + 2).fill('?').join(',')})
       ON CONFLICT(id) DO UPDATE SET ${CARD_COLS.map((c) => `${c}=excluded.${c}`).join(', ')}, updated_at=excluded.updated_at`,
    );
    let i = 0;
    for (const c of feed.values()) {
      const prev = existing.get(c.id);
      const j = join?.get(c.id);
      if (j) stats.joined++;
      const v = variants.get(c.id) ?? { variant_of: null, variant_kind: null };
      const next: CardValues = {
        set_code: c.set_code,
        number: c.number,
        number_int: c.number_int,
        riot_id: c.riot_id,
        public_code: c.public_code,
        name: c.name,
        type: c.type,
        supertype: c.supertype,
        domains: JSON.stringify(c.domains),
        energy: c.energy,
        might: c.might,
        power: c.power,
        rarity: c.rarity,
        rules_text: c.rules_text,
        rules_html: c.rules_html,
        flavor: c.flavor ?? j?.flavor ?? prev?.flavor ?? null,
        artist: c.artist,
        tags: JSON.stringify(c.tags),
        orientation: c.orientation,
        image_url: c.image_url,
        variant_of: v.variant_of,
        variant_kind: v.variant_kind,
        has_foil: j && j.has_foil !== null ? (j.has_foil ? 1 : 0) : prev ? Number(prev.has_foil) : 1,
        has_normal: j && j.has_normal !== null ? (j.has_normal ? 1 : 0) : prev ? Number(prev.has_normal) : 1,
        tcgplayer_id: j && j.tcgplayer_id !== null ? j.tcgplayer_id : prev ? (prev.tcgplayer_id === null ? null : Number(prev.tcgplayer_id)) : null,
        banned: j && j.banned !== null ? (j.banned ? 1 : 0) : prev ? Number(prev.banned) : 0,
        active: 1,
      };
      // A DotGG-only refresh cannot replace previously fetched Riot details.
      if (!c.riot_id && prev?.riot_id) {
        for (const col of ['riot_id', 'public_code', 'name', 'type', 'supertype', 'domains', 'energy', 'might', 'power', 'rarity', 'rules_text', 'rules_html', 'artist', 'tags', 'orientation', 'image_url'] as const) next[col] = prev[col];
      }
      let changed = true;
      if (prev) {
        const prevCmp: CardValues = Object.fromEntries(
          CARD_COLS.map((col) => {
            const val = prev[col];
            const numeric = col === 'number_int' || col === 'energy' || col === 'might' || col === 'power' || col === 'has_foil' || col === 'has_normal' || col === 'tcgplayer_id' || col === 'banned' || col === 'active';
            return [col, numeric && val !== null ? Number(val) : val];
          }),
        ) as CardValues;
        changed = !sameJson(prevCmp, next);
      }
      if (changed) {
        upCard.run(c.id, ...CARD_COLS.map((col) => next[col] as never), now);
        if (prev) stats.updated++;
        else stats.added++;
      } else stats.unchanged++;
      if (++i % 200 === 0) ctx.progress(i, feed.size, 'upserting cards');
    }

    // Relationships may change when a previously missing base printing is discovered.
    for (const r of existing.values()) {
      if (Number(r.active) !== 1 || feed.has(r.id)) continue;
      const v = variants.get(r.id);
      if (v && (v.variant_of !== r.variant_of || v.variant_kind !== r.variant_kind)) {
        sqlRun(db, 'UPDATE cards SET variant_of=?, variant_kind=?, updated_at=? WHERE id=?', v.variant_of, v.variant_kind, now, r.id);
        stats.updated++;
      }
    }

    const anyChange = stats.sets + stats.added + stats.updated + stats.deactivated > 0;
    if (anyChange) {
      const version = bumpCatalogVersion(db);
      const payload: CatalogPayload = { what: 'cards', catalog_version: version, stats: { ...stats } };
      insertChange(db, { kind: 'catalog', reason: 'cards', payload });
    }
  });

  const anyChange = stats.sets + stats.added + stats.updated + stats.deactivated > 0;
  const withTcg = Number(one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM cards WHERE active = 1 AND tcgplayer_id IS NOT NULL`)?.n ?? 0);
  const message = [
    `${src.source}: ${feed.size} cards / ${sets.length} sets`,
    `added ${stats.added}, updated ${stats.updated}, unchanged ${stats.unchanged}, deactivated ${stats.deactivated}`,
    join ? `joined ${stats.joined} (tcgplayer ids on ${withTcg} active cards)` : 'no join',
    joinNote,
  ]
    .filter(Boolean)
    .join(' · ');
  log.info(message);
  return { ok: feed.size, failed, message, changed: anyChange };
}
