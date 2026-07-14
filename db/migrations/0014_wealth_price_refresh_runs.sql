CREATE TABLE wealth_price_refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing','completed','partially_completed','failed')),
  requested_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  warning_json TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_wealth_price_refresh_runs_user_created ON wealth_price_refresh_runs (user_id, created_at);
CREATE INDEX idx_wealth_price_refresh_runs_user_status ON wealth_price_refresh_runs (user_id, status);
