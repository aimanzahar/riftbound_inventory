-- User-authored decks (distinct from the scraped meta_decks, which the meta sync job owns and rewrites).

CREATE TABLE user_decks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  notes      TEXT NOT NULL DEFAULT '',
  color      TEXT,                       -- chip colour on collection tiles (a PALETTE value)
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_user_decks_active ON user_decks(archived, updated_at);

CREATE TABLE user_deck_cards (              -- card_id is a PRINTING id; completion/playset math canonicalises
  deck_id TEXT NOT NULL REFERENCES user_decks(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards(id),
  section TEXT NOT NULL DEFAULT 'main' CHECK (section IN ('main','side','legend','champion','battlefield','runes')),
  qty     INTEGER NOT NULL CHECK (qty > 0),
  PRIMARY KEY (deck_id, card_id, section)
) WITHOUT ROWID;
CREATE INDEX idx_user_deck_cards_card ON user_deck_cards(card_id);

-- changes.kind carries a CHECK constraint and SQLite cannot ALTER one, so the table is rebuilt to add 'deck'.
-- Safe with PRAGMA foreign_keys = ON (which migrations cannot switch off, being inside a transaction) because
-- nothing references `changes` except its own undo_of; the new table self-references, so the DROP is unblocked.
-- ORDER BY seq keeps parents ahead of children for the immediate FK check (undo_of always points at a lower seq).
CREATE TABLE changes_new (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,
  op_id        TEXT UNIQUE,
  device_id    TEXT,
  device_name  TEXT,
  device_color TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('inventory','tip','prices','fx','tips','catalog','settings','deck')),
  reason       TEXT,
  entity       TEXT,
  undo_of      INTEGER REFERENCES changes_new(seq),
  payload      TEXT NOT NULL CHECK (json_valid(payload))
);

INSERT INTO changes_new (seq, ts, op_id, device_id, device_name, device_color, kind, reason, entity, undo_of, payload)
  SELECT seq, ts, op_id, device_id, device_name, device_color, kind, reason, entity, undo_of, payload
  FROM changes ORDER BY seq;

DROP TABLE changes;
ALTER TABLE changes_new RENAME TO changes;

CREATE INDEX idx_changes_entity ON changes(entity, seq);
CREATE INDEX idx_changes_kind   ON changes(kind, reason, seq);
CREATE INDEX idx_changes_undo   ON changes(undo_of) WHERE undo_of IS NOT NULL;
