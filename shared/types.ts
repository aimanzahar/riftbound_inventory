// Shared DTO / contract types used by server, sync jobs and the web client.
// Keep this file free of runtime code (types + small const types only).

export type Finish = 'normal' | 'foil';

export interface SetRow {
  code: string;
  name: string;
  release_date: string | null;
  card_count: number | null;
  printed_total: number | null;
  sort_order: number;
}

export interface Card {
  id: string; // 'OGN-001', 'OGN-007a', 'SFD-227s', 'UNL-T01', 'VEN-R01', 'VEN-SP1'
  set_code: string;
  number: string; // '001', '007a', '227s', 'T01'
  number_int: number;
  riot_id: string | null;
  public_code: string | null;
  name: string;
  type: string | null; // Unit | Spell | Gear | Rune | Legend | Battlefield | Token
  supertype: string | null; // Champion | Signature | Basic | Token | null
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
  variant_of: string | null;
  variant_kind: string | null; // alt_art | showcase | signature | overnumbered | reprint | null
  has_foil: number;
  has_normal: number;
  tcgplayer_id: number | null;
  banned: number;
}

export interface ProductContent {
  card_id: string;
  finish: Finish;
  qty: number;
}

export type ProductKind =
  | 'starter_set'
  | 'champion_deck'
  | 'showdown_deck'
  | 'prerift_kit'
  | 'booster_pack'
  | 'booster_box'
  | 'bundle'
  | 'other';

export interface Product {
  id: string;
  name: string;
  set_code: string | null;
  kind: ProductKind;
  release_date: string | null;
  msrp_usd: number | null;
  tcgplayer_id: number | null;
  image_url: string | null;
  source_url: string | null;
  fixed_contents: number;
  notes: string | null;
  contents: ProductContent[];
}

export type DeckSection = 'main' | 'side' | 'legend' | 'champion' | 'battlefield' | 'runes';

export interface DeckCard {
  card_id: string;
  section: DeckSection;
  qty: number;
}

export interface DeckUnresolved {
  code?: string;
  name?: string;
  qty: number;
  section: DeckSection;
}

export interface Deck {
  id: string;
  name: string;
  legend_card_id: string | null;
  legend_name: string | null;
  champion_card_id: string | null;
  format: string | null;
  source: string;
  source_url: string;
  player: string | null;
  event_name: string | null;
  event_date: string | null;
  event_players: number | null;
  event_tier: string | null;
  placement: number | null;
  region: string | null;
  cards: DeckCard[];
  unresolved: DeckUnresolved[];
}

// ---- user-authored decks (distinct from the scraped meta `Deck` above) ----

export interface UserDeckCard {
  /** a PRINTING id — completion and playset math canonicalise via `variant_of` */
  card_id: string;
  section: DeckSection;
  qty: number;
}

export interface UserDeck {
  id: string;
  name: string;
  notes: string;
  color: string | null;
  archived: number;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  cards: UserDeckCard[];
}

export type UserDeckReason = 'create' | 'update' | 'cards' | 'delete';

export interface UserDeckLine extends UserDeckCard {
  prev_qty: number;
}

export interface UserDeckPayload {
  deck_id: string;
  name: string;
  /** full post-state, or null when deleted — lets clients apply SSE changes without a refetch */
  deck: UserDeck | null;
  /** present when reason === 'cards'; absolute qty per line plus prev_qty so the change can be undone */
  lines?: UserDeckLine[];
  summary: { cards: number; copies_delta: number };
}

export interface InventoryRow {
  card_id: string;
  finish: Finish;
  qty: number;
  note: string;
  updated_at: string;
  updated_by: string | null;
}

export interface Price {
  card_id: string;
  finish: Finish;
  usd_market: number | null;
  usd_low: number | null;
  usd_mid: number | null;
  usd_high: number | null;
  source: string;
  fetched_at: string;
}

export interface Fx {
  base: 'USD';
  quote: 'MYR';
  rate: number;
  day: string;
  source: string;
  fetched_at: string;
  stale: boolean;
}

export interface Tip {
  card_id: string;
  text: string;
  source: 'codex' | 'user';
  model: string | null;
  generated_at: string | null;
  edited_at: string | null;
  edited_by: string | null;
}

export interface Device {
  id: string;
  name: string;
  color: string;
  last_seen_at: string;
}

export interface DeviceRef {
  id: string;
  name: string;
  color: string;
}

export interface InvLine {
  card_id: string;
  finish: Finish;
  qty: number;
  prev_qty: number;
  note: string;
  prev_note?: string;
  clamped?: true;
}

export type ChangeKind = 'inventory' | 'tip' | 'prices' | 'fx' | 'tips' | 'catalog' | 'settings' | 'deck';
export type InventoryReason = 'manual' | 'pack' | 'product' | 'csv' | 'note' | 'undo';
export type InventoryMode = 'add' | 'set' | 'replace';

export interface InventoryPayload {
  mode: InventoryMode;
  lines: InvLine[];
  product?: { id: string; name: string; qty: number };
  csv_filename?: string;
  summary: { cards: number; copies_delta: number; clamped: number };
}
export interface TipPayload {
  card_id: string;
  text: string;
  prev_text: string | null;
}
export interface PricesPayload {
  count: number;
  fetched_at: string;
  source: string;
}
export interface FxPayload {
  rate: number;
  day: string;
  source: string;
}
export interface TipsPayload {
  count: number;
}
export interface CatalogPayload {
  what: 'cards' | 'products' | 'meta';
  catalog_version: number;
  stats?: Record<string, number>;
}
export interface SettingsPayload {
  playset_size: number;
  rune_playset_size: number;
  fx_manual_rate: number | null;
  collection_name: string;
}

export type ChangePayload =
  | InventoryPayload
  | TipPayload
  | PricesPayload
  | FxPayload
  | TipsPayload
  | CatalogPayload
  | SettingsPayload
  | UserDeckPayload;

export interface Change {
  seq: number;
  ts: string;
  op_id: string | null;
  device: DeviceRef | null;
  kind: ChangeKind;
  reason: string | null;
  entity: string | null;
  undo_of: number | null;
  payload: ChangePayload;
  undone: boolean;
}

export interface Settings {
  playset_size: number;
  rune_playset_size: number;
  fx_manual_rate: number | null;
  collection_name: string;
}

export interface JobStatus {
  name: string;
  interval_hours: number | null;
  running: boolean;
  next_due_at: string | null;
  /** finish time of the most recent ok|partial run — the real "data as of", unlike `last` which may be a failure */
  last_success_at: string | null;
  last: {
    status: 'running' | 'ok' | 'partial' | 'error';
    trigger: string;
    started_at: string;
    finished_at: string | null;
    items_ok: number;
    items_failed: number;
    message: string | null;
  } | null;
}

export interface PurchaseRecord {
  seq: number;
  ts: string;
  device: DeviceRef | null;
  product_id: string;
  qty: number;
  undone: boolean;
}

export interface Catalog {
  catalog_version: number;
  sets: SetRow[];
  cards: Card[];
  products: Product[];
  decks: Deck[];
}

export interface ServerInfo {
  version: string;
  started_at: string;
  lan_urls: string[];
  data_dir: string;
  images: { mirrored: number; total: number };
}

export interface State {
  seq: number;
  catalog_version: number;
  inventory: InventoryRow[];
  prices: Price[];
  fx: Fx | null;
  tips: Tip[];
  devices: Device[];
  purchases: PurchaseRecord[];
  user_decks: UserDeck[];
  settings: Settings;
  jobs: JobStatus[];
  server: ServerInfo;
}

// ---- API request / response DTOs ----

export interface InventoryItem {
  card_id: string;
  finish: Finish;
  qty?: number;
  note?: string;
}

export interface InventoryRequest {
  op_id: string;
  reason: Exclude<InventoryReason, 'product' | 'undo'>;
  mode: InventoryMode;
  items: InventoryItem[];
  csv_filename?: string;
}

export interface InventoryResponse {
  change?: Change;
  noop?: true;
  replayed?: true;
}

export interface UserDeckCreateRequest {
  op_id: string;
  name: string;
  notes?: string;
  color?: string | null;
}

export interface UserDeckUpdateRequest {
  op_id: string;
  name?: string;
  notes?: string;
  color?: string | null;
  archived?: boolean;
}

export interface UserDeckCardsRequest {
  op_id: string;
  /** add = apply deltas (a line falling to <= 0 is removed); set = absolute qty */
  mode: 'add' | 'set';
  items: UserDeckCard[];
}

export interface UserDeckResponse {
  deck: UserDeck | null;
  change?: Change;
  replayed?: true;
  noop?: true;
}

export type PurchaseLineStatus = 'new' | 'partial' | 'owned';
export type PurchaseSeverity = 'green' | 'amber' | 'red';

export interface PurchaseLine {
  card_id: string;
  finish: Finish;
  in_product: number;
  owned_now: number;
  owned_after: number;
  status: PurchaseLineStatus;
  dup_copies: number;
  beyond_playset: number;
}

export interface PurchasePreview {
  product: { id: string; name: string; kind: ProductKind };
  qty: number;
  times_bought: number;
  last_bought: { ts: string; device_name: string | null } | null;
  lines: PurchaseLine[];
  summary: {
    distinct: number;
    copies: number;
    new_distinct: number;
    partial_distinct: number;
    owned_distinct: number;
    new_copies: number;
    dup_copies: number;
    beyond_playset_copies: number;
    est_value_usd: number;
    priced_lines: number;
    severity: PurchaseSeverity;
    headline: string;
  };
}

export interface PriceHistoryPoint {
  day: string;
  finish: Finish;
  usd_market: number | null;
  usd_low: number | null;
}

// ---- SSE events ----
export interface HelloEvent {
  seq: number;
  catalog_version: number;
  instance: string;
  server_time: string;
}
export interface PresenceEvent {
  devices: Array<DeviceRef & { tabs: number }>;
}
export interface JobEvent {
  job: string;
  status: 'running' | 'ok' | 'partial' | 'error';
  progress: { done: number; total: number } | null;
  message: string | null;
}

export interface ApiError {
  error: { code: string; message: string; [k: string]: unknown };
}
