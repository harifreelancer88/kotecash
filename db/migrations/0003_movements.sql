-- Universal money-movement ledger. Source→destination across all account kinds.
-- Replaces the role of transactions + transfers + wallet_transactions (those are
-- dropped in 0004 after backfill + verification).
CREATE TABLE movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,                       -- 'YYYY-MM-DD'
  amount INTEGER NOT NULL,                  -- always positive; direction is src→dst
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  src_kind TEXT,                            -- wallet|deposit|portfolio|credit_card|cicilan|NULL(outside)
  src_id INTEGER,
  dst_kind TEXT,                            -- wallet|deposit|portfolio|credit_card|cicilan|NULL(outside)
  dst_id INTEGER,
  recurring_id INTEGER,                     -- soft FK to recurring_templates (added below)
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (amount > 0),
  CHECK (src_kind IS NOT NULL OR dst_kind IS NOT NULL),
  CHECK ((src_kind IS NULL) = (src_id IS NULL)),
  CHECK ((dst_kind IS NULL) = (dst_id IS NULL))
);
CREATE INDEX idx_movements_user_date ON movements (user_id, date DESC, id DESC);
CREATE INDEX idx_movements_src ON movements (user_id, src_kind, src_id);
CREATE INDEX idx_movements_dst ON movements (user_id, dst_kind, dst_id);

CREATE TABLE recurring_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  frequency TEXT NOT NULL,                  -- 'monthly' | 'yearly' | 'weekly' | 'daily'
  day_of_month INTEGER,                     -- 1–31 (monthly/yearly)
  month_of_year INTEGER,                    -- 1–12 (yearly only)
  weekday INTEGER,                          -- 0–6 (weekly only)
  amount INTEGER NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  src_kind TEXT, src_id INTEGER,
  dst_kind TEXT, dst_id INTEGER,
  next_run TEXT NOT NULL,                   -- 'YYYY-MM-DD'
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (amount > 0)
);

CREATE INDEX idx_movements_recurring ON movements (user_id, recurring_id);

ALTER TABLE deposits ADD COLUMN withdrawal_wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL;
ALTER TABLE portfolios ADD COLUMN last_snapshot_at TEXT;
