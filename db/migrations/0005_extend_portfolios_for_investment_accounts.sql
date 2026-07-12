-- Extend legacy portfolios into investment-account records while preserving existing rows and snapshots.
ALTER TABLE portfolios ADD COLUMN account_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE portfolios ADD COLUMN institution TEXT;
ALTER TABLE portfolios ADD COLUMN account_number_masked TEXT;
ALTER TABLE portfolios ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR';
ALTER TABLE portfolios ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portfolios ADD COLUMN opened_at TEXT;
ALTER TABLE portfolios ADD COLUMN closed_at TEXT;
ALTER TABLE portfolios ADD COLUMN include_in_net_worth INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portfolios ADD COLUMN valuation_mode TEXT NOT NULL DEFAULT 'manual_snapshot';
ALTER TABLE portfolios ADD COLUMN notes TEXT;

CREATE INDEX idx_portfolios_user_active ON portfolios (user_id, is_active);
CREATE INDEX idx_portfolios_user_account_type ON portfolios (user_id, account_type);
CREATE INDEX idx_portfolios_user_include_net_worth ON portfolios (user_id, include_in_net_worth);
