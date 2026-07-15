-- PennyWise duplicate review workflow.
-- Duplicate resolution is soft only: movements are preserved and can be audited.
ALTER TABLE movements ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE movements ADD COLUMN duplicate_of_movement_id INTEGER REFERENCES movements(id);
ALTER TABLE movements ADD COLUMN excluded_at TEXT;
ALTER TABLE movements ADD COLUMN excluded_reason TEXT;
ALTER TABLE movements ADD COLUMN exclusion_source TEXT;
ALTER TABLE movements ADD COLUMN updated_at TEXT;

ALTER TABLE pennywise_sync_records ADD COLUMN raw_sms_hash TEXT;
ALTER TABLE pennywise_sync_records ADD COLUMN transaction_time TEXT;

CREATE INDEX idx_movements_user_status_date ON movements(user_id,status,date DESC,id DESC);
CREATE INDEX idx_movements_duplicate_of ON movements(user_id,duplicate_of_movement_id);
CREATE INDEX idx_pennywise_records_raw_sms_hash ON pennywise_sync_records(user_id,raw_sms_hash);
CREATE INDEX idx_pennywise_records_transaction_time ON pennywise_sync_records(user_id,transaction_date,transaction_time);
CREATE INDEX idx_pennywise_records_reference_lookup ON pennywise_sync_records(user_id,transaction_date,amount,reference_number,merchant);

CREATE TABLE pennywise_duplicate_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  candidate_group_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('keep_all','mark_duplicate','ignore','defer')),
  retained_movement_id INTEGER REFERENCES movements(id),
  duplicate_movement_id INTEGER REFERENCES movements(id),
  confidence TEXT NOT NULL,
  reason TEXT,
  dependency_report_json TEXT,
  impact_json TEXT,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by TEXT NOT NULL DEFAULT 'user',
  UNIQUE(user_id,candidate_group_id,action,duplicate_movement_id)
);

CREATE INDEX idx_pennywise_duplicate_reviews_user_group ON pennywise_duplicate_reviews(user_id,candidate_group_id,reviewed_at DESC);

CREATE TABLE pennywise_duplicate_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  candidate_group_id TEXT,
  movement_id INTEGER REFERENCES movements(id),
  event_type TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pennywise_duplicate_audit_user ON pennywise_duplicate_audit_events(user_id,candidate_group_id,created_at DESC);
