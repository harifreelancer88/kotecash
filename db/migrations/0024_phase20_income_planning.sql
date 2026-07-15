-- Phase 20: income source tracking, expected occurrences, and matching allocations.
CREATE TABLE income_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  income_type TEXT NOT NULL CHECK (income_type IN ('salary','freelance','business','rental','interest','dividend','pension','government_benefit','bonus','reimbursement','refund','other')),
  institution_or_payer TEXT,
  account_number_masked TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  expected_amount INTEGER CHECK (expected_amount IS NULL OR expected_amount >= 0),
  amount_variability TEXT NOT NULL DEFAULT 'fixed' CHECK (amount_variability IN ('fixed','variable','irregular')),
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','fortnightly','monthly','quarterly','half_yearly','yearly','irregular','one_time')),
  expected_day INTEGER,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  include_in_forecast INTEGER NOT NULL DEFAULT 1,
  linked_wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  linked_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  notes TEXT,
  metadata_json TEXT,
  employer TEXT,
  salary_account TEXT,
  expected_gross_credit INTEGER CHECK (expected_gross_credit IS NULL OR expected_gross_credit >= 0),
  expected_net_credit INTEGER CHECK (expected_net_credit IS NULL OR expected_net_credit >= 0),
  salary_day INTEGER,
  payroll_frequency TEXT CHECK (payroll_frequency IS NULL OR payroll_frequency IN ('weekly','fortnightly','monthly','quarterly','half_yearly','yearly','irregular','one_time')),
  fixed_component INTEGER CHECK (fixed_component IS NULL OR fixed_component >= 0),
  variable_component INTEGER CHECK (variable_component IS NULL OR variable_component >= 0),
  expected_bonus_month INTEGER CHECK (expected_bonus_month IS NULL OR expected_bonus_month BETWEEN 1 AND 12),
  reimbursement_behavior TEXT,
  expected_min_amount INTEGER CHECK (expected_min_amount IS NULL OR expected_min_amount >= 0),
  conservative_estimate INTEGER CHECK (conservative_estimate IS NULL OR conservative_estimate >= 0),
  base_estimate INTEGER CHECK (base_estimate IS NULL OR base_estimate >= 0),
  optimistic_estimate INTEGER CHECK (optimistic_estimate IS NULL OR optimistic_estimate >= 0),
  probability REAL CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
  planned_invoice_date TEXT,
  expected_payment_date TEXT,
  payer_client TEXT,
  invoice_reference TEXT,
  effective_from TEXT,
  effective_to TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  archived_at TEXT,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  CHECK (expected_day IS NULL OR expected_day BETWEEN 1 AND 31),
  CHECK (salary_day IS NULL OR salary_day BETWEEN 1 AND 31)
);
CREATE INDEX idx_income_sources_user_active ON income_sources(user_id, active, archived_at);

CREATE TABLE income_source_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  income_source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  expected_amount INTEGER CHECK (expected_amount IS NULL OR expected_amount >= 0),
  expected_gross_credit INTEGER CHECK (expected_gross_credit IS NULL OR expected_gross_credit >= 0),
  expected_net_credit INTEGER CHECK (expected_net_credit IS NULL OR expected_net_credit >= 0),
  fixed_component INTEGER CHECK (fixed_component IS NULL OR fixed_component >= 0),
  variable_component INTEGER CHECK (variable_component IS NULL OR variable_component >= 0),
  frequency TEXT CHECK (frequency IS NULL OR frequency IN ('weekly','fortnightly','monthly','quarterly','half_yearly','yearly','irregular','one_time')),
  expected_day INTEGER CHECK (expected_day IS NULL OR expected_day BETWEEN 1 AND 31),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX idx_income_source_versions_source ON income_source_versions(user_id, income_source_id, effective_from);

CREATE TABLE expected_income_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  income_source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL,
  expected_date TEXT NOT NULL,
  expected_amount INTEGER NOT NULL CHECK (expected_amount >= 0),
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','due_soon','due_today','received','partially_received','overdue','skipped','cancelled','unmatched')),
  matched_movement_id INTEGER REFERENCES movements(id) ON DELETE SET NULL,
  actual_amount INTEGER CHECK (actual_amount IS NULL OR actual_amount >= 0),
  actual_date TEXT,
  variance_amount INTEGER,
  source TEXT NOT NULL DEFAULT 'generated' CHECK (source IN ('generated','manual','import','migration')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, income_source_id, occurrence_key)
);
CREATE UNIQUE INDEX idx_expected_income_one_movement ON expected_income_occurrences(user_id, matched_movement_id) WHERE matched_movement_id IS NOT NULL;
CREATE INDEX idx_expected_income_user_date ON expected_income_occurrences(user_id, expected_date, status);

CREATE TABLE income_occurrence_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  occurrence_id INTEGER NOT NULL REFERENCES expected_income_occurrences(id) ON DELETE CASCADE,
  movement_id INTEGER NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  allocation_amount INTEGER NOT NULL CHECK (allocation_amount > 0),
  allocation_type TEXT NOT NULL DEFAULT 'manual' CHECK (allocation_type IN ('manual','suggested','split','combined')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, occurrence_id, movement_id)
);
CREATE INDEX idx_income_allocations_movement ON income_occurrence_allocations(user_id, movement_id);

CREATE TABLE income_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
