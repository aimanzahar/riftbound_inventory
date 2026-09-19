-- Validated marketplace bindings override community feed suggestions.
CREATE TABLE market_mappings (
  card_id TEXT PRIMARY KEY REFERENCES cards(id),
  product_id INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE market_rejections (
  card_id TEXT NOT NULL REFERENCES cards(id),
  product_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  rejected_at TEXT NOT NULL,
  PRIMARY KEY(card_id, product_id)
);
-- Preserve the original data before resetting a demonstrably contaminated series.
CREATE TABLE price_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id),
  rejected_product_id INTEGER NOT NULL,
  prices_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  corrected_at TEXT NOT NULL
);
