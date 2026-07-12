CREATE TABLE investment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  account_id INTEGER NOT NULL REFERENCES portfolios(id),
  asset_id INTEGER REFERENCES investment_assets(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('buy','sell','sip','redemption','dividend','interest','contribution','withdrawal','transfer_in','transfer_out','bonus','split','charges','maturity')),
  trade_date TEXT NOT NULL,
  settlement_date TEXT,
  quantity TEXT,
  unit_price TEXT,
  gross_amount INTEGER,
  charges INTEGER NOT NULL DEFAULT 0,
  taxes INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER,
  movement_id INTEGER REFERENCES movements(id),
  external_ref TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_investment_transactions_user ON investment_transactions (user_id);
CREATE INDEX idx_investment_transactions_user_account ON investment_transactions (user_id, account_id);
CREATE INDEX idx_investment_transactions_user_asset ON investment_transactions (user_id, asset_id);
CREATE INDEX idx_investment_transactions_user_trade_date ON investment_transactions (user_id, trade_date);
CREATE INDEX idx_investment_transactions_user_type ON investment_transactions (user_id, transaction_type);
CREATE INDEX idx_investment_transactions_user_account_asset_date ON investment_transactions (user_id, account_id, asset_id, trade_date);
CREATE INDEX idx_investment_transactions_user_movement ON investment_transactions (user_id, movement_id);
