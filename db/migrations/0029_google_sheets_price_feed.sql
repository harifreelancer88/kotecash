-- Google Sheets price feed asset mapping and lookup indexes.
ALTER TABLE investment_assets ADD COLUMN price_feed_asset_key TEXT;

CREATE UNIQUE INDEX idx_investment_assets_feed_key_unique
  ON investment_assets (user_id, lower(price_feed_asset_key))
  WHERE price_feed_asset_key IS NOT NULL AND is_active <> 0;

CREATE INDEX idx_investment_assets_user_feed_key
  ON investment_assets (user_id, price_feed_asset_key);
