import type { Db } from '../db/open.ts';
import { all, getSetting } from '../db/open.ts';
import type { Card, Catalog, Deck, DeckCard, DeckSection, Product, ProductContent, SetRow } from '../../shared/types.ts';

interface CardRow extends Omit<Card, 'domains' | 'tags'> {
  domains: string;
  tags: string;
}

let cache: { version: number; catalog: Catalog; json: Buffer } | null = null;

export function cardFromRow(r: CardRow): Card {
  return {
    ...r,
    number_int: Number(r.number_int),
    energy: r.energy === null ? null : Number(r.energy),
    might: r.might === null ? null : Number(r.might),
    power: r.power === null ? null : Number(r.power),
    has_foil: Number(r.has_foil),
    has_normal: Number(r.has_normal),
    tcgplayer_id: r.tcgplayer_id === null ? null : Number(r.tcgplayer_id),
    banned: Number(r.banned),
    domains: safeArr(r.domains),
    tags: safeArr(r.tags),
  };
}

function safeArr(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function buildCatalog(db: Db): { catalog: Catalog; json: Buffer } {
  const version = getSetting<number>(db, 'catalog_version', 1);
  if (cache && cache.version === version) return { catalog: cache.catalog, json: cache.json };

  const result = db.read(() => {
    const sets = all<SetRow>(db, 'SELECT code, name, release_date, card_count, printed_total, sort_order FROM sets ORDER BY sort_order, release_date, code').map((s) => ({
      ...s,
      card_count: s.card_count === null ? null : Number(s.card_count),
      printed_total: s.printed_total === null ? null : Number(s.printed_total),
      sort_order: Number(s.sort_order),
    }));
    const cards = all<CardRow>(
      db,
      `SELECT c.id, c.set_code, c.number, c.number_int, c.riot_id, c.public_code, c.name, c.type, c.supertype, c.domains, c.energy, c.might, c.power,
              c.rarity, c.rules_text, c.rules_html, c.flavor, c.artist, c.tags, c.orientation, c.image_url, c.variant_of, c.variant_kind,
              c.has_foil, c.has_normal, c.tcgplayer_id, c.banned
       FROM cards c JOIN sets s ON s.code = c.set_code
       WHERE c.active = 1
       ORDER BY s.sort_order, s.release_date, c.set_code, c.number_int, c.number`,
    ).map(cardFromRow);

    const products = all<Omit<Product, 'contents'>>(
      db,
      `SELECT id, name, set_code, kind, release_date, msrp_usd, tcgplayer_id, image_url, source_url, fixed_contents, notes
       FROM products WHERE active = 1 ORDER BY release_date, name`,
    ).map((p) => ({ ...p, fixed_contents: Number(p.fixed_contents), msrp_usd: p.msrp_usd === null ? null : Number(p.msrp_usd), tcgplayer_id: p.tcgplayer_id === null ? null : Number(p.tcgplayer_id), contents: [] as ProductContent[] }));
    const byProduct = new Map(products.map((p) => [p.id, p]));
    for (const pc of all<ProductContent & { product_id: string }>(db, 'SELECT product_id, card_id, finish, qty FROM product_contents ORDER BY product_id, card_id, finish')) {
      byProduct.get(pc.product_id)?.contents.push({ card_id: pc.card_id, finish: pc.finish, qty: Number(pc.qty) });
    }

    const decks = all<Omit<Deck, 'cards' | 'unresolved'> & { unresolved: string }>(
      db,
      `SELECT id, name, legend_card_id, legend_name, champion_card_id, format, source, source_url, player, event_name, event_date, event_players, event_tier, placement, region, unresolved
       FROM meta_decks WHERE active = 1 ORDER BY event_date DESC, placement ASC`,
    ).map((d) => ({
      ...d,
      event_players: d.event_players === null ? null : Number(d.event_players),
      placement: d.placement === null ? null : Number(d.placement),
      cards: [] as DeckCard[],
      unresolved: safeJson(d.unresolved),
    }));
    const byDeck = new Map(decks.map((d) => [d.id, d]));
    for (const dc of all<{ deck_id: string; card_id: string; section: DeckSection; qty: number }>(db, 'SELECT deck_id, card_id, section, qty FROM meta_deck_cards')) {
      byDeck.get(dc.deck_id)?.cards.push({ card_id: dc.card_id, section: dc.section, qty: Number(dc.qty) });
    }

    const catalog: Catalog = { catalog_version: version, sets, cards, products, decks: decks as Deck[] };
    return catalog;
  });
  const json = Buffer.from(JSON.stringify(result));
  cache = { version, catalog: result, json };
  return { catalog: result, json };
}

function safeJson<T = unknown>(s: string): T[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function invalidateCatalogCache(): void {
  cache = null;
}
