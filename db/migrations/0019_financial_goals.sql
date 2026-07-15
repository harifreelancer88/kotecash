-- Phase 12: financial goals, goal links, planning contributions.
CREATE TABLE financial_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('emergency_fund','retirement','child_education','home_purchase','vehicle_purchase','debt_payoff','vacation','wedding','major_purchase','custom')),
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  target_date TEXT,
  current_manual_amount INTEGER CHECK (current_manual_amount IS NULL OR current_manual_amount >= 0),
  funding_mode TEXT NOT NULL DEFAULT 'manual' CHECK (funding_mode IN ('linked_assets','manual','hybrid')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','cancelled')),
  start_date TEXT,
  inflation_rate REAL,
  expected_return_rate REAL,
  monthly_contribution_override INTEGER CHECK (monthly_contribution_override IS NULL OR monthly_contribution_override >= 0),
  include_existing_assets INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  CHECK (target_date IS NULL OR start_date IS NULL OR target_date >= start_date),
  CHECK (inflation_rate IS NULL OR (inflation_rate >= -50 AND inflation_rate <= 100)),
  CHECK (expected_return_rate IS NULL OR (expected_return_rate >= -100 AND expected_return_rate <= 100))
);
CREATE INDEX idx_financial_goals_user_status ON financial_goals(user_id,status);
CREATE INDEX idx_financial_goals_user_type ON financial_goals(user_id,goal_type);
CREATE INDEX idx_financial_goals_user_priority ON financial_goals(user_id,priority);
CREATE INDEX idx_financial_goals_target_date ON financial_goals(user_id,target_date);

CREATE TABLE financial_goal_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  goal_id INTEGER NOT NULL REFERENCES financial_goals(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('wealth_account','wealth_asset','liability')),
  account_id INTEGER REFERENCES portfolios(id),
  asset_id INTEGER REFERENCES investment_assets(id),
  liability_id INTEGER REFERENCES liabilities(id),
  allocation_percent REAL,
  fixed_allocation_amount INTEGER CHECK (fixed_allocation_amount IS NULL OR fixed_allocation_amount >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (allocation_percent IS NULL OR (allocation_percent >= 0 AND allocation_percent <= 100)),
  CHECK ((account_id IS NOT NULL) + (asset_id IS NOT NULL) + (liability_id IS NOT NULL) = 1),
  UNIQUE(user_id, goal_id, link_type, account_id, asset_id, liability_id)
);
CREATE INDEX idx_financial_goal_links_goal ON financial_goal_links(user_id,goal_id);
CREATE INDEX idx_financial_goal_links_account ON financial_goal_links(user_id,account_id);
CREATE INDEX idx_financial_goal_links_asset ON financial_goal_links(user_id,asset_id);
CREATE INDEX idx_financial_goal_links_liability ON financial_goal_links(user_id,liability_id);

CREATE TABLE goal_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  goal_id INTEGER NOT NULL REFERENCES financial_goals(id) ON DELETE CASCADE,
  contribution_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','linked_movement','linked_investment','import','adjustment')),
  movement_id INTEGER REFERENCES movements(id),
  investment_transaction_id INTEGER REFERENCES investment_transactions(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((movement_id IS NULL) OR source='linked_movement'),
  CHECK ((investment_transaction_id IS NULL) OR source='linked_investment')
);
CREATE UNIQUE INDEX uq_goal_contribution_movement ON goal_contributions(user_id,goal_id,movement_id) WHERE movement_id IS NOT NULL;
CREATE UNIQUE INDEX uq_goal_contribution_investment_tx ON goal_contributions(user_id,goal_id,investment_transaction_id) WHERE investment_transaction_id IS NOT NULL;
CREATE INDEX idx_goal_contributions_goal_date ON goal_contributions(user_id,goal_id,contribution_date);
