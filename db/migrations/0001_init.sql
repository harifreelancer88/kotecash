-- Users
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Categories
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'income' | 'expense'
  is_debt_service INTEGER NOT NULL DEFAULT 0, -- 1 = Exclude from general budgets
  created_at TEXT DEFAULT (datetime('now'))
);

-- Wallets
CREATE TABLE wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'bank' | 'e-wallet' | 'cash'
  account_number TEXT,
  initial_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cicilan (Installments)
CREATE TABLE cicilan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  total_utang INTEGER NOT NULL,
  monthly_payment INTEGER NOT NULL,
  tenor_bulan INTEGER,
  bunga_persen REAL DEFAULT 0,
  start_date TEXT NOT NULL, -- 'YYYY-MM-DD'
  due_date TEXT NOT NULL, -- 'YYYY-MM-DD'
  status TEXT DEFAULT 'active', -- 'active' | 'paid_off'
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Goals
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  target_amount INTEGER NOT NULL,
  icon TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Credit Cards
CREATE TABLE credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  limit_amount INTEGER NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  statement_day INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  min_payment_pct REAL DEFAULT 10,
  interest_rate REAL DEFAULT 0,
  annual_fee INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Deposits (Assets)
CREATE TABLE deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  bank TEXT NOT NULL,
  amount INTEGER NOT NULL,
  rate REAL DEFAULT 0,
  tenor_months INTEGER NOT NULL,
  start_date TEXT NOT NULL, -- 'YYYY-MM-DD'
  maturity_date TEXT NOT NULL, -- 'YYYY-MM-DD'
  status TEXT DEFAULT 'active', -- 'active' | 'matured'
  created_at TEXT DEFAULT (datetime('now'))
);

-- Portfolios (Assets)
CREATE TABLE portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Net Worth snapshots
CREATE TABLE net_worth_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  month TEXT NOT NULL, -- 'YYYY-MM'
  assets INTEGER NOT NULL,
  liabilities INTEGER NOT NULL,
  net_worth INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, month)
);

-- API Tokens (AI Hermes integration)
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- Budgets
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  budget_amount INTEGER NOT NULL,
  month TEXT NOT NULL, -- 'YYYY-MM'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, category_id, month)
);

-- Transactions (General Ledger)
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL, -- 'YYYY-MM-DD'
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  amount INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  type TEXT NOT NULL, -- 'income' | 'expense'
  cicilan_id INTEGER REFERENCES cicilan(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Wallet Transactions
CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'income' | 'expense' | 'transfer_in' | 'transfer_out'
  amount INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  date TEXT NOT NULL, -- 'YYYY-MM-DD'
  target_wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  source_wallet_id INTEGER REFERENCES wallets(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Earmarks
CREATE TABLE earmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL, -- 'wallet' | 'deposit' | 'portfolio'
  source_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Double-Entry Transfers
CREATE TABLE transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  from_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  to_wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
