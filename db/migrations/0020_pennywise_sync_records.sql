-- PennyWise SMS integration provenance and idempotency records.
-- Stores normalized sync metadata only; never stores raw SMS bodies or API tokens.
CREATE TABLE pennywise_sync_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  client_transaction_id TEXT NOT NULL,
  sms_fingerprint TEXT,
  movement_id INTEGER REFERENCES movements(id) ON DELETE SET NULL,
  sync_status TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'sms',
  error_code TEXT,
  error_message TEXT,
  request_fingerprint TEXT NOT NULL,
  financial_fingerprint TEXT,
  reference_number TEXT,
  merchant TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, client_id, client_transaction_id),
  UNIQUE(user_id, sms_fingerprint)
);

CREATE INDEX idx_pennywise_records_user_status ON pennywise_sync_records(user_id, sync_status, transaction_date DESC);
CREATE INDEX idx_pennywise_records_user_date ON pennywise_sync_records(user_id, transaction_date DESC, id DESC);
CREATE INDEX idx_pennywise_records_financial ON pennywise_sync_records(user_id, financial_fingerprint);
CREATE INDEX idx_pennywise_records_movement ON pennywise_sync_records(user_id, movement_id);
