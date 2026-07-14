CREATE TABLE wealth_provider_symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  asset_id INTEGER NOT NULL REFERENCES investment_assets(id),
  provider TEXT NOT NULL,
  provider_symbol TEXT NOT NULL,
  provider_exchange TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, asset_id, provider)
);
CREATE INDEX idx_wealth_provider_symbols_user_provider ON wealth_provider_symbols (user_id, provider);
