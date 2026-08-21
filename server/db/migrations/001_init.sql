CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                      -- JSON-encoded
);

CREATE TABLE sets (
  code          TEXT PRIMARY KEY,          -- 'OGN'
  name          TEXT NOT NULL,
  release_date  TEXT,                      -- 'YYYY-MM-DD'
  card_count    INTEGER,                   -- printings in gallery
  printed_total INTEGER,                   -- printed set total (e.g. 298)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

CREATE TABLE cards (                       -- one row per PRINTING
  id              TEXT PRIMARY KEY,        -- 'OGN-001', 'OGN-007a', 'SFD-227s', 'UNL-T01', 'VEN-R01', 'VEN-SP1'
  set_code        TEXT NOT NULL REFERENCES sets(code),
  number          TEXT NOT NULL,           -- '001', '007a', '227s', 'T01', 'R01', 'SP1'
  number_int      INTEGER NOT NULL,
  riot_id         TEXT,                    -- 'ogn-007a-298'
  public_code     TEXT,                    -- 'OGN-007a/298'
  name            TEXT NOT NULL,
  type            TEXT,
  supertype       TEXT,
  domains         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(domains)),
  energy          INTEGER,
  might           INTEGER,
  power           INTEGER,
  rarity          TEXT,
  rules_text      TEXT,
  rules_html      TEXT,
  flavor          TEXT,
  artist          TEXT,
  tags            TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  orientation     TEXT NOT NULL DEFAULT 'portrait',
  image_url       TEXT,
  variant_of      TEXT REFERENCES cards(id),
  variant_kind    TEXT,                    -- alt_art | showcase | signature | overnumbered | reprint
  has_foil        INTEGER NOT NULL DEFAULT 1,
  has_normal      INTEGER NOT NULL DEFAULT 1,
  tcgplayer_id    INTEGER,
  banned          INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL,
  UNIQUE (set_code, number)
);
CREATE INDEX idx_cards_set_num  ON cards(set_code, number_int, number);
CREATE INDEX idx_cards_name     ON cards(name COLLATE NOCASE);
CREATE INDEX idx_cards_variant  ON cards(variant_of);
CREATE INDEX idx_cards_tcg      ON cards(tcgplayer_id) WHERE tcgplayer_id IS NOT NULL;

CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
  color        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE inventory (                   -- shared pool; one row per (printing, finish); never deleted
  card_id    TEXT NOT NULL REFERENCES cards(id),
  finish     TEXT NOT NULL CHECK (finish IN ('normal','foil')),
  qty        INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  note       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (card_id, finish)
) WITHOUT ROWID;
CREATE INDEX idx_inventory_owned ON inventory(card_id) WHERE qty > 0;

CREATE TABLE changes (                     -- OUTBOX (SSE) + AUDIT + UNDO source
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  op_id        TEXT UNIQUE,
  device_id    TEXT,
  device_name  TEXT,
  device_color TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('inventory','tip','prices','fx','tips','catalog','settings')),
  reason       TEXT,
  entity       TEXT,
  undo_of      INTEGER REFERENCES changes(seq),
  payload      TEXT NOT NULL CHECK (json_valid(payload))
);
CREATE INDEX idx_changes_entity ON changes(entity, seq);
CREATE INDEX idx_changes_kind   ON changes(kind, reason, seq);
CREATE INDEX idx_changes_undo   ON changes(undo_of) WHERE undo_of IS NOT NULL;

CREATE TABLE products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  set_code       TEXT REFERENCES sets(code),
  kind           TEXT NOT NULL CHECK (kind IN ('starter_set','champion_deck','showdown_deck','prerift_kit','booster_pack','booster_box','bundle','other')),
  release_date   TEXT,
  msrp_usd       REAL,
  tcgplayer_id   INTEGER,
  image_url      TEXT,
  source_url     TEXT,
  fixed_contents INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL
);
CREATE TABLE product_contents (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  card_id    TEXT NOT NULL REFERENCES cards(id),
  finish     TEXT NOT NULL DEFAULT 'normal' CHECK (finish IN ('normal','foil')),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (product_id, card_id, finish)
) WITHOUT ROWID;
CREATE INDEX idx_product_contents_card ON product_contents(card_id);

CREATE TABLE prices (
  card_id    TEXT NOT NULL REFERENCES cards(id),
  finish     TEXT NOT NULL CHECK (finish IN ('normal','foil')),
  usd_market REAL CHECK (usd_market IS NULL OR usd_market >= 0),
  usd_low    REAL,
  usd_mid    REAL,
  usd_high   REAL,
  source     TEXT NOT NULL,
  source_ref TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (card_id, finish)
) WITHOUT ROWID;

CREATE TABLE price_history (
  card_id    TEXT NOT NULL,
  finish     TEXT NOT NULL,
  day        TEXT NOT NULL,
  usd_market REAL,
  usd_low    REAL,
  PRIMARY KEY (card_id, finish, day)
) WITHOUT ROWID;

CREATE TABLE fx_rates (
  base       TEXT NOT NULL,
  quote      TEXT NOT NULL,
  day        TEXT NOT NULL,
  rate       REAL NOT NULL CHECK (rate > 0),
  source     TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (base, quote, day)
);

CREATE TABLE meta_decks (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  legend_card_id   TEXT REFERENCES cards(id),
  legend_name      TEXT,
  champion_card_id TEXT REFERENCES cards(id),
  format           TEXT,
  source           TEXT NOT NULL,
  source_url       TEXT NOT NULL,
  player           TEXT,
  event_name       TEXT,
  event_date       TEXT,
  event_players    INTEGER,
  event_tier       TEXT,
  placement        INTEGER,
  region           TEXT,
  unresolved       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(unresolved)),
  fetched_at       TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source, source_url)
);
CREATE INDEX idx_meta_decks_active ON meta_decks(active, event_date);

CREATE TABLE meta_deck_cards (
  deck_id TEXT NOT NULL REFERENCES meta_decks(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  section TEXT NOT NULL DEFAULT 'main' CHECK (section IN ('main','side','legend','champion','battlefield','runes')),
  qty     INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (deck_id, card_id, section)
) WITHOUT ROWID;
CREATE INDEX idx_meta_deck_cards_card ON meta_deck_cards(card_id);

CREATE TABLE tips (
  card_id      TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  text         TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 400),
  source       TEXT NOT NULL CHECK (source IN ('codex','user')),
  model        TEXT,
  generated_at TEXT,
  edited_at    TEXT,
  edited_by    TEXT
);

CREATE TABLE job_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job          TEXT NOT NULL,
  trigger      TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  status       TEXT NOT NULL CHECK (status IN ('running','ok','partial','error')),
  items_ok     INTEGER NOT NULL DEFAULT 0,
  items_failed INTEGER NOT NULL DEFAULT 0,
  message      TEXT
);
CREATE INDEX idx_job_runs_job ON job_runs(job, id DESC);
