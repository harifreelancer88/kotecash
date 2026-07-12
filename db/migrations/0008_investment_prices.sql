CREATE TABLE investment_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  asset_id INTEGER NOT NULL REFERENCES investment_assets(id),
  price_date TEXT NOT NULL,
  price TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','market','nav','snapshot')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, asset_id, price_date)
);
CREATE INDEX idx_investment_prices_user_asset_date ON investment_prices (user_id, asset_id, price_date);
CREATE INDEX idx_investment_prices_user_date ON investment_prices (user_id, price_date);
CREATE INDEX idx_investment_prices_user_source ON investment_prices (user_id, source);
