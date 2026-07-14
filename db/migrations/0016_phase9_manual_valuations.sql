-- Phase 9: manual/snapshot valuations and expanded wealth metadata.
ALTER TABLE portfolios ADD COLUMN metadata TEXT;

ALTER TABLE investment_assets ADD COLUMN metadata TEXT;
ALTER TABLE investment_assets ADD COLUMN account_id INTEGER REFERENCES portfolios(id);
ALTER TABLE investment_assets ADD COLUMN valuation_mode TEXT;

CREATE TABLE wealth_valuation_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  account_id INTEGER NOT NULL REFERENCES portfolios(id),
  asset_id INTEGER REFERENCES investment_assets(id),
  valuation_date TEXT NOT NULL,
  invested_value INTEGER,
  current_value INTEGER NOT NULL CHECK (current_value >= 0),
  accrued_interest INTEGER,
  contribution_total INTEGER,
  employer_contribution INTEGER,
  employee_contribution INTEGER,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','formula','migration')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, account_id, asset_id, valuation_date)
);
CREATE UNIQUE INDEX uq_wealth_valuation_snapshots_account_null_asset ON wealth_valuation_snapshots(user_id, account_id, valuation_date) WHERE asset_id IS NULL;
CREATE INDEX idx_wealth_valuation_snapshots_user_date ON wealth_valuation_snapshots (user_id, valuation_date);
CREATE INDEX idx_wealth_valuation_snapshots_account_date ON wealth_valuation_snapshots (account_id, valuation_date);
CREATE INDEX idx_wealth_valuation_snapshots_asset_date ON wealth_valuation_snapshots (asset_id, valuation_date);

-- Expand normalized transaction types while preserving existing rows.
CREATE TABLE investment_transactions_phase9 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  account_id INTEGER NOT NULL REFERENCES portfolios(id),
  asset_id INTEGER REFERENCES investment_assets(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('buy','sell','sip','contribution','employer_contribution','employee_contribution','interest','dividend','withdrawal','redemption','maturity','transfer_in','transfer_out','fee','tax','adjustment','bonus','split','charges')),
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
  import_batch_id INTEGER REFERENCES wealth_import_batches(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO investment_transactions_phase9 SELECT * FROM investment_transactions;
DROP TABLE investment_transactions;
ALTER TABLE investment_transactions_phase9 RENAME TO investment_transactions;
CREATE INDEX idx_investment_transactions_user ON investment_transactions (user_id);
CREATE INDEX idx_investment_transactions_user_account ON investment_transactions (user_id, account_id);
CREATE INDEX idx_investment_transactions_user_asset ON investment_transactions (user_id, asset_id);
CREATE INDEX idx_investment_transactions_user_trade_date ON investment_transactions (user_id, trade_date);
CREATE INDEX idx_investment_transactions_user_type ON investment_transactions (user_id, transaction_type);
CREATE INDEX idx_investment_transactions_user_account_asset_date ON investment_transactions (user_id, account_id, asset_id, trade_date);
CREATE INDEX idx_investment_transactions_user_movement ON investment_transactions (user_id, movement_id);
CREATE INDEX idx_investment_transactions_user_import_batch ON investment_transactions (user_id, import_batch_id);
