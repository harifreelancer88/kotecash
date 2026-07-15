CREATE TABLE account_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  snapshot_date TEXT NOT NULL,
  balance INTEGER NOT NULL,
  available_balance INTEGER,
  ledger_balance INTEGER,
  currency TEXT NOT NULL DEFAULT 'IDR',
  source TEXT NOT NULL CHECK (source IN ('manual','statement','import','opening_balance','migration','reconciliation_adjustment')),
  statement_period_start TEXT,
  statement_period_end TEXT,
  import_batch_id INTEGER REFERENCES financial_import_batches(id),
  external_reference TEXT,
  notes TEXT,
  is_reconciled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, wallet_id, snapshot_date, source)
);
CREATE INDEX idx_account_balance_snapshots_wallet_date ON account_balance_snapshots(user_id,wallet_id,snapshot_date DESC);
CREATE INDEX idx_account_balance_snapshots_import_batch ON account_balance_snapshots(user_id,import_batch_id);

CREATE TABLE account_reconciliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  opening_balance INTEGER,
  expected_closing_balance INTEGER,
  statement_closing_balance INTEGER,
  difference INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','reconciled','small_difference','unreconciled','locked','cancelled')),
  source TEXT NOT NULL DEFAULT 'manual',
  import_batch_id INTEGER REFERENCES financial_import_batches(id),
  locked INTEGER NOT NULL DEFAULT 0,
  reconciled_at TEXT,
  locked_at TEXT,
  notes TEXT,
  matched_count INTEGER NOT NULL DEFAULT 0,
  unresolved_count INTEGER NOT NULL DEFAULT 0,
  adjustment_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (date(period_end) >= date(period_start))
);
CREATE INDEX idx_account_reconciliations_wallet_period ON account_reconciliations(user_id,wallet_id,period_start,period_end,status);
CREATE UNIQUE INDEX idx_account_reconciliations_active_overlap_guard ON account_reconciliations(user_id,wallet_id,period_start,period_end) WHERE status NOT IN ('cancelled','locked');

CREATE TABLE account_reconciliation_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reconciliation_id INTEGER NOT NULL REFERENCES account_reconciliations(id),
  movement_id INTEGER,
  import_row_id INTEGER REFERENCES financial_import_rows(id),
  row_type TEXT NOT NULL CHECK (row_type IN ('ledger_movement','imported_statement_row','balance_adjustment','opening_balance','unmatched_statement_row','unmatched_ledger_row')),
  transaction_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit','debit','adjustment')),
  description TEXT,
  reference_number TEXT,
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('exact','probable','possible','unmatched','excluded','resolved')),
  resolution TEXT NOT NULL DEFAULT 'unresolved' CHECK (resolution IN ('matched_existing','import_as_new','skip_statement_row','mark_ledger_valid','mark_duplicate','create_adjustment','unresolved')),
  confidence TEXT NOT NULL DEFAULT 'unmatched' CHECK (confidence IN ('exact','high','medium','low','unmatched')),
  discrepancy_reason TEXT,
  duplicate_status TEXT NOT NULL DEFAULT 'not_duplicate' CHECK (duplicate_status IN ('exact_duplicate','probable_duplicate','possible_duplicate','not_duplicate','resolved_duplicate')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_account_reconciliation_rows_rec ON account_reconciliation_rows(user_id,reconciliation_id,match_status,resolution);
CREATE INDEX idx_account_reconciliation_rows_movement ON account_reconciliation_rows(user_id,movement_id);
CREATE INDEX idx_account_reconciliation_rows_import ON account_reconciliation_rows(user_id,import_row_id);

CREATE TABLE account_reconciliation_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  reconciliation_id INTEGER,
  snapshot_id INTEGER,
  event_type TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_account_reconciliation_audit_user ON account_reconciliation_audit_events(user_id,reconciliation_id,created_at DESC);
