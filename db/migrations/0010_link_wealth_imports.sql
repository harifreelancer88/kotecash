ALTER TABLE investment_transactions ADD COLUMN import_batch_id INTEGER REFERENCES wealth_import_batches(id);
ALTER TABLE investment_prices ADD COLUMN import_batch_id INTEGER REFERENCES wealth_import_batches(id);
CREATE INDEX idx_investment_transactions_user_import_batch ON investment_transactions (user_id, import_batch_id);
CREATE INDEX idx_investment_prices_user_import_batch ON investment_prices (user_id, import_batch_id);
