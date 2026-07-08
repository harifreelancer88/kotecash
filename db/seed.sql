-- KoteCash — demo seed data.
-- Populates a realistic household ledger for user_id = 1 (the auto-seeded admin)
-- so every feature has something to show: categories, wallets, deposits, portfolios,
-- credit cards, cicilan, goals + earmarks, budgets, recurring templates, and ~5 months
-- of movements (so the net-worth trend has history).
--
-- Run ONCE on a fresh DB, AFTER migrations and AFTER the first login (which seeds the
-- admin user):
--   npx wrangler d1 migrations apply kotecash-db --remote
--   # log in once at your deployed URL (admin@example.com / admin) to create user_id=1
--   npx wrangler d1 execute kotecash-db --remote --file db/seed.sql
--
-- All amounts are IDR integers. Replace with your own data or clear it anytime:
--   DELETE FROM movements; DELETE FROM recurring_templates; DELETE FROM earmarks;
--   DELETE FROM budgets; DELETE FROM goals; DELETE FROM cicilan; DELETE FROM credit_cards;
--   DELETE FROM portfolios; DELETE FROM deposits; DELETE FROM wallets; DELETE FROM categories;
--   DELETE FROM balance_history;

-- ── Categories ────────────────────────────────────────────────
INSERT INTO categories (id, user_id, name, type, is_debt_service) VALUES
  (1, 1, 'Salary',        'income',  0),
  (2, 1, 'Freelance',     'income',  0),
  (3, 1, 'Groceries',     'expense', 0),
  (4, 1, 'Transport',     'expense', 0),
  (5, 1, 'Dining',        'expense', 0),
  (6, 1, 'Utilities',     'expense', 0),
  (7, 1, 'Entertainment', 'expense', 0),
  (8, 1, 'Rent',          'expense', 0),
  (9, 1, 'Healthcare',    'expense', 0),
  (10, 1, 'Shopping',     'expense', 0),
  (11, 1, 'Debt Service', 'expense', 1);

-- ── Wallets ───────────────────────────────────────────────────
INSERT INTO wallets (id, user_id, name, type, account_number, initial_balance) VALUES
  (1, 1, 'BCA',   'bank',     '1234567890', 5000000),
  (2, 1, 'GoPay', 'e-wallet', NULL,           800000),
  (3, 1, 'Cash',  'cash',     NULL,           500000),
  (4, 1, 'OVO',   'e-wallet', NULL,           300000);

-- ── Deposits ──────────────────────────────────────────────────
INSERT INTO deposits (id, user_id, bank, amount, rate, tenor_months, start_date, maturity_date, status, withdrawal_wallet_id) VALUES
  (1, 1, 'BCA', 50000000, 4.5, 6, '2026-01-15', '2026-07-15', 'active', 1);

-- ── Portfolios ────────────────────────────────────────────────
INSERT INTO portfolios (id, user_id, name, value, updated_at, last_snapshot_at) VALUES
  (1, 1, 'Stock Portfolio', 26000000, '2026-06-01 00:00:00', '2026-06-01 00:00:00'),
  (2, 1, 'Mutual Funds',    10500000, '2026-06-01 00:00:00', '2026-06-01 00:00:00');

-- Portfolio value history (used for the net-worth trend + currentValue).
INSERT INTO balance_history (user_id, entity_kind, entity_id, amount, recorded_at) VALUES
  (1, 'portfolio', 1, 22000000, '2026-02-28 23:59:59'),
  (1, 'portfolio', 1, 23000000, '2026-03-31 23:59:59'),
  (1, 'portfolio', 1, 24000000, '2026-04-30 23:59:59'),
  (1, 'portfolio', 1, 25000000, '2026-05-31 23:59:59'),
  (1, 'portfolio', 1, 26000000, '2026-06-01 00:00:00'),
  (1, 'portfolio', 2,  9000000, '2026-02-28 23:59:59'),
  (1, 'portfolio', 2,  9500000, '2026-03-31 23:59:59'),
  (1, 'portfolio', 2, 10000000, '2026-04-30 23:59:59'),
  (1, 'portfolio', 2, 10000000, '2026-05-31 23:59:59'),
  (1, 'portfolio', 2, 10500000, '2026-06-01 00:00:00');

-- ── Credit Cards ──────────────────────────────────────────────
INSERT INTO credit_cards (id, user_id, name, limit_amount, balance, statement_day, due_day, min_payment_pct, interest_rate, annual_fee) VALUES
  (1, 1, 'Visa Credit Card', 15000000, 2000000, 5, 25, 10, 36, 0);

-- ── Cicilan (installment debt) ────────────────────────────────
INSERT INTO cicilan (id, user_id, name, total_utang, monthly_payment, tenor_bulan, bunga_persen, start_date, due_date, status, notes) VALUES
  (1, 1, 'Car Loan', 80000000, 4000000, 24, 6, '2026-01-01', '2027-12-01', 'active', 'Demo auto loan');

-- ── Goals + Earmarks ──────────────────────────────────────────
INSERT INTO goals (id, user_id, name, target_amount, icon) VALUES
  (1, 1, 'Emergency Fund',  50000000, 'shield'),
  (2, 1, 'Family Vacation', 20000000, 'plane'),
  (3, 1, 'New Laptop',      18000000, 'laptop');

INSERT INTO earmarks (id, user_id, goal_id, source_type, source_id, amount) VALUES
  (1, 1, 1, 'wallet',    1, 8000000),
  (2, 1, 2, 'wallet',    1, 3000000),
  (3, 1, 3, 'portfolio', 1, 5000000);

-- ── Budgets (current month: 2026-06) ──────────────────────────
INSERT INTO budgets (user_id, category_id, budget_amount, month) VALUES
  (1, 3, 2500000, '2026-06'),   -- Groceries
  (1, 4,  800000, '2026-06'),   -- Transport
  (1, 5, 1500000, '2026-06'),   -- Dining
  (1, 6, 1200000, '2026-06'),   -- Utilities
  (1, 7,  600000, '2026-06'),   -- Entertainment
  (1, 8, 3000000, '2026-06'),   -- Rent
  (1, 9,  800000, '2026-06'),   -- Healthcare
  (1, 10, 1500000, '2026-06');  -- Shopping

-- ── Recurring templates ───────────────────────────────────────
INSERT INTO recurring_templates (id, user_id, frequency, day_of_month, month_of_year, weekday, amount, description, category_id, src_kind, src_id, dst_kind, dst_id, next_run, active) VALUES
  (1, 1, 'monthly', 25, NULL, NULL, 15000000, 'Salary',           1, NULL, NULL, 'wallet', 1, '2026-07-25', 1),
  (2, 1, 'monthly',  5, NULL, NULL,  3000000, 'Rent',             8, 'wallet', 1, NULL,     NULL, '2026-07-05', 1),
  (3, 1, 'monthly', 10, NULL, NULL,  1200000, 'Utilities',        6, 'wallet', 1, NULL,     NULL, '2026-07-10', 1),
  (4, 1, 'monthly', 15, NULL, NULL,  4000000, 'Car Loan Payment', 11,'wallet', 1, 'cicilan', 1, '2026-07-15', 1);

-- ── Movements: prior months (net-worth trend history) ─────────
-- February 2026
INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES
  (1, '2026-02-25', 15000000, 'Salary February', 1, NULL, NULL, 'wallet', 1),
  (1, '2026-02-05', 3000000,  'Rent February',   8, 'wallet', 1, NULL, NULL),
  (1, '2026-02-15', 4000000,  'Car Loan Feb',    11,'wallet', 1, 'cicilan', 1),
  (1, '2026-02-10', 1200000,  'Utilities Feb',   6, 'wallet', 1, NULL, NULL),
  (1, '2026-02-12',  850000,  'Groceries Feb',   3, 'wallet', 1, NULL, NULL),
  (1, '2026-02-18',  420000,  'Dining Feb',      5, 'wallet', 1, NULL, NULL);

-- March 2026
INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES
  (1, '2026-03-25', 15000000, 'Salary March',    1, NULL, NULL, 'wallet', 1),
  (1, '2026-03-05', 3000000,  'Rent March',      8, 'wallet', 1, NULL, NULL),
  (1, '2026-03-15', 4000000,  'Car Loan Mar',    11,'wallet', 1, 'cicilan', 1),
  (1, '2026-03-10', 1200000,  'Utilities Mar',   6, 'wallet', 1, NULL, NULL),
  (1, '2026-03-12', 1100000,  'Groceries Mar',   3, 'wallet', 1, NULL, NULL),
  (1, '2026-03-20',  650000,  'Transport Mar',   4, 'wallet', 1, NULL, NULL),
  (1, '2026-03-28', 1500000,  'Mutual fund sale',2, 'portfolio', 2, 'wallet', 1);

-- April 2026
INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES
  (1, '2026-04-25', 15000000, 'Salary April',    1, NULL, NULL, 'wallet', 1),
  (1, '2026-04-05', 3000000,  'Rent April',      8, 'wallet', 1, NULL, NULL),
  (1, '2026-04-15', 4000000,  'Car Loan Apr',    11,'wallet', 1, 'cicilan', 1),
  (1, '2026-04-10', 1200000,  'Utilities Apr',   6, 'wallet', 1, NULL, NULL),
  (1, '2026-04-14', 1250000,  'Groceries Apr',   3, 'wallet', 1, NULL, NULL),
  (1, '2026-04-22',  780000,  'Shopping Apr',    10,'wallet', 1, NULL, NULL);

-- May 2026
INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES
  (1, '2026-05-25', 15000000, 'Salary May',      1, NULL, NULL, 'wallet', 1),
  (1, '2026-05-05', 3000000,  'Rent May',        8, 'wallet', 1, NULL, NULL),
  (1, '2026-05-15', 4000000,  'Car Loan May',    11,'wallet', 1, 'cicilan', 1),
  (1, '2026-05-10', 1200000,  'Utilities May',   6, 'wallet', 1, NULL, NULL),
  (1, '2026-05-12', 1320000,  'Groceries May',   3, 'wallet', 1, NULL, NULL),
  (1, '2026-05-18',  540000,  'Dining May',      5, 'wallet', 1, NULL, NULL),
  (1, '2026-05-20',  900000,  'Healthcare May',  9, 'wallet', 1, NULL, NULL),
  (1, '2026-05-08', 2000000,  'Buy stocks',      2, 'wallet', 1, 'portfolio', 1);

-- ── Movements: current month (June 2026) — full detail ────────
INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES
  -- income
  (1, '2026-06-20', 15000000, 'Salary June',         1, NULL, NULL, 'wallet', 1),
  (1, '2026-06-08',  2500000, 'Freelance project',   2, NULL, NULL, 'wallet', 1),
  -- fixed
  (1, '2026-06-05', 3000000,  'Rent June',           8, 'wallet', 1, NULL, NULL),
  (1, '2026-06-10', 1200000,  'Electricity & water', 6, 'wallet', 1, NULL, NULL),
  (1, '2026-06-15', 4000000,  'Car Loan June',       11,'wallet', 1, 'cicilan', 1),
  -- variable expenses
  (1, '2026-06-02',  450000,  'Weekly groceries',    3, 'wallet', 1, NULL, NULL),
  (1, '2026-06-09',  520000,  'Weekly groceries',    3, 'wallet', 1, NULL, NULL),
  (1, '2026-06-16',  610000,  'Weekly groceries',    3, 'wallet', 1, NULL, NULL),
  (1, '2026-06-04',  150000,  'Fuel',                4, 'wallet', 1, NULL, NULL),
  (1, '2026-06-11',   85000,  'Ride share',          4, 'wallet', 2, NULL, NULL),
  (1, '2026-06-07',  220000,  'Dinner out',          5, 'wallet', 1, NULL, NULL),
  (1, '2026-06-14',  180000,  'Coffee & lunch',      5, 'wallet', 3, NULL, NULL),
  (1, '2026-06-13',  320000,  'Shopping',            10,'wallet', 1, NULL, NULL),
  (1, '2026-06-17',  600000,  'Pharmacy',            9, 'wallet', 1, NULL, NULL),
  (1, '2026-06-21',  149000,  'Streaming',           7, 'credit_card', 1, NULL, NULL),  -- CC charge
  (1, '2026-06-18', 1000000,  'CC payment',          7, 'wallet', 1, 'credit_card', 1),  -- pay down CC
  -- transfers & investments
  (1, '2026-06-06',  500000,  'Top-up GoPay',        NULL, 'wallet', 1, 'wallet', 2),
  (1, '2026-06-19', 2000000,  'Buy stocks',          2, 'wallet', 1, 'portfolio', 1);
