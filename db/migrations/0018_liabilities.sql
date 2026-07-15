CREATE TABLE liabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  liability_type TEXT NOT NULL,
  institution TEXT,
  account_number_masked TEXT,
  currency TEXT NOT NULL DEFAULT 'IDR',
  original_principal INTEGER NOT NULL DEFAULT 0 CHECK(original_principal >= 0),
  current_outstanding INTEGER NOT NULL DEFAULT 0 CHECK(current_outstanding >= 0),
  interest_rate REAL NOT NULL DEFAULT 0,
  interest_type TEXT NOT NULL DEFAULT 'manual',
  emi_amount INTEGER NOT NULL DEFAULT 0 CHECK(emi_amount >= 0),
  repayment_frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT,
  maturity_date TEXT,
  next_due_date TEXT,
  payment_day INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  include_in_net_worth INTEGER NOT NULL DEFAULT 1,
  auto_calculation_mode TEXT NOT NULL DEFAULT 'manual',
  linked_wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  linked_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  credit_limit INTEGER,
  statement_balance INTEGER,
  available_credit INTEGER,
  statement_date TEXT,
  due_date TEXT,
  minimum_due INTEGER,
  full_payment_amount INTEGER,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE INDEX idx_liabilities_user_status ON liabilities(user_id,status);
CREATE INDEX idx_liabilities_user_type ON liabilities(user_id,liability_type);
CREATE INDEX idx_liabilities_due ON liabilities(user_id,next_due_date,due_date);

CREATE TABLE liability_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  liability_id INTEGER NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  payment_amount INTEGER NOT NULL CHECK(payment_amount >= 0),
  principal_component INTEGER CHECK(principal_component IS NULL OR principal_component >= 0),
  interest_component INTEGER CHECK(interest_component IS NULL OR interest_component >= 0),
  fee_component INTEGER CHECK(fee_component IS NULL OR fee_component >= 0),
  tax_component INTEGER CHECK(tax_component IS NULL OR tax_component >= 0),
  outstanding_after INTEGER CHECK(outstanding_after IS NULL OR outstanding_after >= 0),
  payment_type TEXT NOT NULL DEFAULT 'emi',
  movement_id INTEGER REFERENCES movements(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, movement_id)
);
CREATE INDEX idx_liability_payments_liability_date ON liability_payments(liability_id,payment_date);

CREATE TABLE liability_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  liability_id INTEGER NOT NULL REFERENCES liabilities(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  outstanding_balance INTEGER NOT NULL CHECK(outstanding_balance >= 0),
  accrued_interest INTEGER CHECK(accrued_interest IS NULL OR accrued_interest >= 0),
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, liability_id, snapshot_date)
);
CREATE INDEX idx_liability_snapshots_liability_date ON liability_balance_snapshots(liability_id,snapshot_date);
