-- User-scoped investment instruments for the Personal Wealth module foundation.
CREATE TABLE investment_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  asset_type TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT,
  isin TEXT,
  exchange TEXT,
  scheme_code TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  price_source TEXT NOT NULL DEFAULT 'manual',
  pricing_mode TEXT NOT NULL DEFAULT 'manual',
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_investment_assets_user ON investment_assets (user_id);
CREATE INDEX idx_investment_assets_user_type ON investment_assets (user_id, asset_type);
CREATE INDEX idx_investment_assets_user_symbol_exchange ON investment_assets (user_id, symbol, exchange);
CREATE INDEX idx_investment_assets_user_isin ON investment_assets (user_id, isin);
CREATE INDEX idx_investment_assets_user_scheme_code ON investment_assets (user_id, scheme_code);
CREATE INDEX idx_investment_assets_user_active ON investment_assets (user_id, is_active);
