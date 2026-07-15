-- Phase 22: households, family members, generic ownership, and shared expense allocations.
CREATE TABLE households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'IDR',
  household_type TEXT NOT NULL DEFAULT 'individual' CHECK (household_type IN ('individual','family','joint','other')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_households_user_active ON households(user_id,active);

CREATE TABLE household_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship IN ('self','spouse','child','parent','sibling','dependant','other')),
  date_of_birth TEXT,
  dependent INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  CHECK (date_of_birth IS NULL OR date(date_of_birth) <= date('now'))
);
CREATE UNIQUE INDEX uq_household_members_one_self ON household_members(user_id,household_id) WHERE relationship='self' AND archived_at IS NULL;
CREATE INDEX idx_household_members_household ON household_members(user_id,household_id,active);

CREATE TABLE financial_record_ownership (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  record_type TEXT NOT NULL CHECK (record_type IN ('wallet','wealth_account','wealth_asset','liability','goal','income_source','budget','insurance_policy_future','other_asset')),
  record_id INTEGER NOT NULL,
  member_id INTEGER REFERENCES household_members(id),
  ownership_type TEXT NOT NULL CHECK (ownership_type IN ('individual','joint','household','custodial','beneficiary','shared_expense')),
  ownership_percent REAL NOT NULL DEFAULT 100 CHECK (ownership_percent >= 0 AND ownership_percent <= 100),
  allocation_basis TEXT NOT NULL DEFAULT 'full' CHECK (allocation_basis IN ('percentage','equal','full','informational')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_financial_record_ownership_row ON financial_record_ownership(user_id,record_type,record_id,member_id,ownership_type);
CREATE INDEX idx_financial_record_ownership_record ON financial_record_ownership(user_id,record_type,record_id);
CREATE INDEX idx_financial_record_ownership_member ON financial_record_ownership(user_id,member_id);

CREATE TABLE movement_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  household_id INTEGER NOT NULL REFERENCES households(id),
  movement_id INTEGER NOT NULL REFERENCES movements(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES household_members(id),
  allocation_type TEXT NOT NULL CHECK (allocation_type IN ('individual','equal_split','percentage','fixed_amount','household')),
  allocation_percent REAL CHECK (allocation_percent IS NULL OR (allocation_percent >= 0 AND allocation_percent <= 100)),
  allocation_amount INTEGER CHECK (allocation_amount IS NULL OR allocation_amount >= 0),
  purpose TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX uq_movement_allocations_row ON movement_allocations(user_id,movement_id,member_id,allocation_type);
CREATE INDEX idx_movement_allocations_movement ON movement_allocations(user_id,movement_id);

CREATE TABLE household_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  household_id INTEGER,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE net_worth_snapshots ADD COLUMN household_id INTEGER;
ALTER TABLE net_worth_snapshots ADD COLUMN ownership_breakdown_json TEXT;

INSERT INTO households(user_id,name,base_currency,household_type,active)
SELECT id, 'My Household', 'IDR', 'individual', 1 FROM users u
WHERE NOT EXISTS (SELECT 1 FROM households h WHERE h.user_id=u.id);

INSERT INTO household_members(user_id,household_id,display_name,relationship,dependent,active,sort_order)
SELECT h.user_id,h.id,'Self','self',0,1,0 FROM households h
WHERE NOT EXISTS (SELECT 1 FROM household_members m WHERE m.user_id=h.user_id AND m.household_id=h.id AND m.relationship='self' AND m.archived_at IS NULL);
