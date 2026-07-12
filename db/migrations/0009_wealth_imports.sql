CREATE TABLE wealth_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'generic_csv',
  status TEXT NOT NULL CHECK (status IN ('uploaded','previewed','validated','partially_imported','imported','failed','rolled_back')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  mapping_json TEXT,
  options_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  committed_at TEXT,
  rolled_back_at TEXT
);
CREATE INDEX idx_wealth_import_batches_user_status ON wealth_import_batches (user_id, status);
CREATE INDEX idx_wealth_import_batches_user_created ON wealth_import_batches (user_id, created_at);
CREATE INDEX idx_wealth_import_batches_user_file_hash ON wealth_import_batches (user_id, file_hash);

CREATE TABLE wealth_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  batch_id INTEGER NOT NULL REFERENCES wealth_import_batches(id),
  row_number INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  normalized_json TEXT,
  fingerprint TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','valid','invalid','duplicate','imported','skipped','failed','rolled_back')),
  error_code TEXT,
  error_message TEXT,
  warning_json TEXT,
  created_account_id INTEGER,
  created_asset_id INTEGER,
  created_transaction_id INTEGER,
  created_price_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wealth_import_rows_user_batch ON wealth_import_rows (user_id, batch_id);
CREATE INDEX idx_wealth_import_rows_user_batch_status ON wealth_import_rows (user_id, batch_id, status);
CREATE INDEX idx_wealth_import_rows_user_fingerprint ON wealth_import_rows (user_id, fingerprint);
CREATE INDEX idx_wealth_import_rows_user_created_transaction ON wealth_import_rows (user_id, created_transaction_id);
CREATE INDEX idx_wealth_import_rows_user_created_price ON wealth_import_rows (user_id, created_price_id);
