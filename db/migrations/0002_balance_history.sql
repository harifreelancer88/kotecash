-- Append-only balance history for entities whose value is otherwise destructive.
-- Wallets & cicilan are NOT here: their balances derive from dated transactions.
CREATE TABLE balance_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity_kind TEXT NOT NULL,   -- 'portfolio' | 'deposit' | 'credit_card'
  entity_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_balance_history_lookup ON balance_history (user_id, entity_kind, entity_id, recorded_at);

-- Baseline backfill: seed one history row per existing entity at current value.
INSERT INTO balance_history (user_id, entity_kind, entity_id, amount)
  SELECT user_id, 'portfolio', id, value FROM portfolios;
INSERT INTO balance_history (user_id, entity_kind, entity_id, amount)
  SELECT user_id, 'deposit', id, amount FROM deposits;
INSERT INTO balance_history (user_id, entity_kind, entity_id, amount)
  SELECT user_id, 'credit_card', id, balance FROM credit_cards;
