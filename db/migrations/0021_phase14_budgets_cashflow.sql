-- Phase 14: normalized budgets, category classifications, alert dismissals.
ALTER TABLE budgets ADD COLUMN name TEXT;
ALTER TABLE budgets ADD COLUMN start_date TEXT;
ALTER TABLE budgets ADD COLUMN end_date TEXT;
ALTER TABLE budgets ADD COLUMN budget_type TEXT NOT NULL DEFAULT 'monthly_category';
ALTER TABLE budgets ADD COLUMN parent_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
ALTER TABLE budgets ADD COLUMN amount INTEGER;
ALTER TABLE budgets ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN rollover_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE budgets ADD COLUMN alert_percent REAL NOT NULL DEFAULT 0.8;
ALTER TABLE budgets ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE budgets ADD COLUMN notes TEXT;
ALTER TABLE budgets ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
UPDATE budgets SET amount = budget_amount WHERE amount IS NULL;
UPDATE budgets SET name = 'Budget ' || month WHERE name IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_active_category_month
  ON budgets(user_id, category_id, month)
  WHERE status='active' AND budget_type='monthly_category' AND category_id IS NOT NULL;

CREATE TABLE category_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  classification TEXT NOT NULL CHECK (classification IN ('fixed','variable','discretionary','essential','debt_payment','investment','transfer','income')),
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, category_id)
);

CREATE TABLE alert_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  alert_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  dismissed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, alert_key, fingerprint)
);
