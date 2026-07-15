CREATE TABLE financial_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  import_type TEXT NOT NULL CHECK (import_type IN ('bank_statement','credit_card_statement','loan_statement','mutual_fund_statement','epf_statement','nps_statement','generic_ledger','generic_valuation','generic_liability')),
  source_institution TEXT,
  source_filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  statement_period_start TEXT,
  statement_period_end TEXT,
  status TEXT NOT NULL CHECK (status IN ('uploaded','previewed','needs_mapping','validated','ready','committed','partially_committed','rolled_back','failed')),
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  committed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  committed_at TEXT,
  rolled_back_at TEXT,
  metadata_json TEXT
);
CREATE UNIQUE INDEX idx_financial_import_batches_user_hash_active ON financial_import_batches(user_id,file_hash) WHERE status <> 'rolled_back';
CREATE INDEX idx_financial_import_batches_user_status ON financial_import_batches(user_id,status,created_at DESC);

CREATE TABLE financial_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  batch_id INTEGER NOT NULL REFERENCES financial_import_batches(id),
  row_number INTEGER NOT NULL,
  raw_row_json TEXT NOT NULL,
  normalized_type TEXT,
  normalized_date TEXT,
  normalized_amount INTEGER,
  normalized_direction TEXT,
  normalized_description TEXT,
  normalized_reference TEXT,
  normalized_account TEXT,
  normalized_category TEXT,
  normalized_balance INTEGER,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  duplicate_status TEXT NOT NULL DEFAULT 'new',
  match_status TEXT NOT NULL DEFAULT 'unmatched',
  resolution TEXT NOT NULL DEFAULT 'pending',
  created_record_type TEXT,
  created_record_id INTEGER,
  matched_record_type TEXT,
  matched_record_id INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_financial_import_rows_user_batch ON financial_import_rows(user_id,batch_id,row_number);
CREATE INDEX idx_financial_import_rows_user_status ON financial_import_rows(user_id,batch_id,validation_status,duplicate_status,match_status);
CREATE INDEX idx_financial_import_rows_created_record ON financial_import_rows(user_id,created_record_type,created_record_id);

CREATE TABLE financial_import_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  institution TEXT,
  import_type TEXT NOT NULL,
  column_mapping_json TEXT NOT NULL,
  date_format TEXT,
  amount_convention TEXT,
  header_row INTEGER NOT NULL DEFAULT 1,
  rows_to_skip INTEGER NOT NULL DEFAULT 0,
  account_mapping_json TEXT,
  wallet_category_defaults_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_financial_import_templates_user_type ON financial_import_templates(user_id,import_type,active);

CREATE TABLE financial_import_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  batch_id INTEGER REFERENCES financial_import_batches(id),
  event_type TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_financial_import_audit_user_batch ON financial_import_audit_events(user_id,batch_id,created_at DESC);
