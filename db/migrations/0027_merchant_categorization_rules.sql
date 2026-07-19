CREATE TABLE merchant_categorization_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_merchant_name TEXT NOT NULL,
  normalized_merchant_name TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('expense','income')),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_merchant_rules_unique_active ON merchant_categorization_rules (user_id, normalized_merchant_name, movement_type, active);
CREATE INDEX idx_merchant_rules_lookup ON merchant_categorization_rules (user_id, normalized_merchant_name, movement_type, active);
CREATE INDEX idx_merchant_rules_category ON merchant_categorization_rules (user_id, category_id);
