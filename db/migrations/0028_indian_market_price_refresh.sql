-- Add provider-neutral configuration and audit metadata for automated Indian EOD price refresh.
ALTER TABLE investment_assets ADD COLUMN price_provider TEXT NOT NULL DEFAULT 'manual' CHECK (price_provider IN ('manual','nse_bhavcopy','yahoo_finance','mfapi'));
ALTER TABLE investment_assets ADD COLUMN provider_symbol TEXT;
ALTER TABLE investment_assets ADD COLUMN provider_exchange TEXT;
ALTER TABLE investment_assets ADD COLUMN provider_scheme_code TEXT;
ALTER TABLE investment_assets ADD COLUMN automatic_price_refresh INTEGER NOT NULL DEFAULT 0;
ALTER TABLE investment_assets ADD COLUMN last_price_refresh_at TEXT;
ALTER TABLE investment_assets ADD COLUMN last_price_refresh_status TEXT;
ALTER TABLE investment_assets ADD COLUMN last_price_refresh_error TEXT;
ALTER TABLE investment_assets ADD COLUMN last_provider_timestamp TEXT;
ALTER TABLE investment_assets ADD COLUMN last_provider_trade_date TEXT;
CREATE INDEX idx_investment_assets_auto_refresh ON investment_assets (user_id, automatic_price_refresh, price_provider, asset_type, is_active);
CREATE INDEX idx_investment_assets_provider_symbol ON investment_assets (user_id, price_provider, provider_exchange, provider_symbol);
CREATE INDEX idx_investment_assets_provider_scheme ON investment_assets (user_id, price_provider, provider_scheme_code);

ALTER TABLE investment_prices ADD COLUMN provider TEXT;
ALTER TABLE investment_prices ADD COLUMN provider_symbol TEXT;
ALTER TABLE investment_prices ADD COLUMN provider_timestamp TEXT;
ALTER TABLE investment_prices ADD COLUMN fetched_at TEXT;
ALTER TABLE investment_prices ADD COLUMN source_type TEXT;
CREATE INDEX idx_investment_prices_provider_key ON investment_prices (user_id, asset_id, provider, provider_timestamp);

ALTER TABLE wealth_price_refresh_runs ADD COLUMN trigger TEXT;
ALTER TABLE wealth_price_refresh_runs ADD COLUMN scope TEXT;
ALTER TABLE wealth_price_refresh_runs ADD COLUMN target_date TEXT;
ALTER TABLE wealth_price_refresh_runs ADD COLUMN provider_counts_json TEXT;
ALTER TABLE wealth_price_refresh_runs ADD COLUMN result_json TEXT;
ALTER TABLE wealth_price_refresh_runs ADD COLUMN batch_error TEXT;
CREATE INDEX idx_wealth_price_refresh_runs_logical ON wealth_price_refresh_runs (user_id, trigger, scope, target_date, status);
