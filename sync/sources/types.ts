// Shared shapes produced by the pluggable data sources (sync/sources/*).
// Jobs (sync/cards.ts, prices.ts, meta.ts) consume these and do the DB work.
import type { DeckSection, Finish } from '../../shared/types.ts';

export interface SourceSet {
  code: string; // 'OGN'
  name: string;
  printed_total: number | null; // collectorNumberMax
  release_date: string | null; // 'YYYY-MM-DD'
}

/** One printing, already mapped to our id scheme (no DB-derived fields like variant_of). */
export interface SourceCard {
  id: string; // 'OGN-007a'
  set_code: string;
  number: string; // '007a'
  number_int: number;
  suffix: string; // '', 'a', 'b', 's'
  riot_id: string | null;
  public_code: string | null;
  name: string;
  /** Gameplay name for grouping printings, without promo labels. */
  canonical_name?: string;
  printing_kind?: string | null;
  type: string | null;
  supertype: string | null;
  domains: string[];
  energy: number | null;
  might: number | null;
  power: number | null;
  rarity: string | null;
  rules_text: string | null;
  rules_html: string | null;
  flavor: string | null;
  artist: string | null;
  tags: string[];
  orientation: 'portrait' | 'landscape';
  image_url: string | null;
}

/** Per-card extras joined from a secondary source (DotGG today). */
export interface CardJoinRow {
  id: string; // our id
  tcgplayer_id: number | null;
  has_normal: boolean | null;
  has_foil: boolean | null;
  banned: boolean | null;
  flavor: string | null;
  price: number | null; // TCGplayer market USD (normal)
  foil_price: number | null;
}

export interface CardSourceResult {
  source: string; // 'riot' | 'localjson'
  sets: SourceSet[];
  cards: SourceCard[];
  /** optional join rows shipped with a local file */
  join?: CardJoinRow[];
  note?: string;
  diagnostics?: { failed: number; warnings: string[] };
}

/** A price observation for one (card, finish). card_id is already resolved to our id. */
export interface PriceRow {
  card_id: string;
  finish: Finish;
  usd_market: number | null;
  usd_low: number | null;
  usd_mid: number | null;
  usd_high: number | null;
  source: string; // 'tcgplayer' | 'tcgplayer-dotgg' | 'localjson'
  source_ref: string | null;
}

/** A deck as delivered by a meta source, before card-id resolution. */
export interface MetaDeckCardInput {
  code: string | null; // 'OGN-043/298', 'OGN-043', 'ogn-043-298' — anything normalizeCommunityId/fromRiotId understands
  name: string | null;
  qty: number;
  section: DeckSection;
}

export interface MetaDeckInput {
  source: string; // 'riftools' | 'boundrift' | 'localjson'
  source_url: string;
  name: string;
  legend_name: string | null;
  legend_code: string | null;
  champion_code: string | null;
  player: string | null;
  event_name: string | null;
  event_date: string | null;
  event_players: number | null;
  event_tier: string | null;
  placement: number | null;
  region: string | null;
  format: string | null;
  cards: MetaDeckCardInput[];
}
