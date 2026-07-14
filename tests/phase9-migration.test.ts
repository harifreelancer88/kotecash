import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const through0015 = [
  'db/migrations/0001_init.sql',
  'db/migrations/0002_balance_history.sql',
  'db/migrations/0003_movements.sql',
  'db/migrations/0004_drop_legacy_ledgers.sql',
  'db/migrations/0005_extend_portfolios_for_investment_accounts.sql',
  'db/migrations/0006_investment_assets.sql',
  'db/migrations/0007_investment_transactions.sql',
  'db/migrations/0008_investment_prices.sql',
  'db/migrations/0009_wealth_imports.sql',
  'db/migrations/0010_link_wealth_imports.sql',
  'db/migrations/0011_net_worth_snapshot_breakdown.sql',
  'db/migrations/0012_ai_document_extractions.sql',
  'db/migrations/0013_ai_extraction_status_fields.sql',
  'db/migrations/0014_wealth_price_refresh_runs.sql',
  'db/migrations/0015_market_price_provider_symbols.sql',
];

function sqlite(db: string, text: string, json = false) {
  return execFileSync('sqlite3', json ? ['-json', db] : [db], { input: `PRAGMA foreign_keys=ON;\n${text}`, encoding: 'utf8' });
}

function rows<T = any>(db: string, text: string): T[] {
  return JSON.parse(sqlite(db, text, true) || '[]');
}

function applyThrough0015(db: string) {
  for (const migration of through0015) sqlite(db, readFileSync(migration, 'utf8'));
}

function seedProductionLikeWealthData(db: string) {
  sqlite(db, `
    INSERT INTO users (id,email,password_hash) VALUES (1,'owner@example.com','hash');
    INSERT INTO categories (id,user_id,name,type) VALUES (10,1,'Opening capital','income');
    INSERT INTO portfolios (id,user_id,name,value,account_type,institution,account_number_masked,currency,is_active,valuation_mode,notes)
      VALUES (20,1,'Zerodha',0,'brokerage','Zerodha','1234','INR',1,'holdings','Production-like brokerage account');
    INSERT INTO movements (id,user_id,date,amount,description,category_id,src_kind,src_id,dst_kind,dst_id)
      VALUES (30,1,'2026-04-01',137706,'Fund Zerodha trade',10,NULL,NULL,'portfolio',20);
    INSERT INTO investment_assets (id,user_id,asset_type,name,symbol,isin,exchange,currency,price_source,pricing_mode,is_active,notes)
      VALUES
        (100,1,'stock','Tata Consultancy Services','TCS','INE467B01029','NSE','INR','import','manual',1,'Imported stock'),
        (101,1,'stock','BPCL','BPCL','INE029A01011','NSE','INR','import','manual',1,'Imported stock'),
        (102,1,'stock','Nestle India','NESTLEIND','INE239A01024','NSE','INR','import','manual',1,'Imported stock');
    INSERT INTO wealth_import_batches (id,user_id,file_name,file_hash,source_type,status,total_rows,valid_rows,imported_rows,mapping_json,options_json,committed_at)
      VALUES (200,1,'zerodha-fy.csv','hash-zerodha-fy','zerodha_csv','imported',5,5,5,'{}','{}',datetime('now'));
    INSERT INTO investment_transactions (id,user_id,account_id,asset_id,transaction_type,trade_date,settlement_date,quantity,unit_price,gross_amount,charges,taxes,net_amount,movement_id,external_ref,notes,import_batch_id,created_at,updated_at)
      VALUES
        (1000,1,20,100,'transfer_in','2026-03-31',NULL,'10','2400',24000,0,0,24000,NULL,'open-tcs','Opening imported holding',200,'2026-04-01 00:00:00','2026-04-01 00:00:00'),
        (1001,1,20,101,'transfer_in','2026-03-31',NULL,'172','301',51772,0,0,51772,NULL,'open-bpcl','Opening imported holding',200,'2026-04-01 00:01:00','2026-04-01 00:01:00'),
        (1002,1,20,100,'buy','2026-04-01','2026-04-02','57','2415.899902',137706,10,5,137721,30,'tcs-buy','Current FY buy',200,'2026-04-02 00:00:00','2026-04-02 00:00:00'),
        (1003,1,20,100,'sell','2026-05-04','2026-05-05','57','2457',140049,11,6,140032,NULL,'tcs-sell','Current FY sell',200,'2026-05-05 00:00:00','2026-05-05 00:00:00'),
        (1004,1,20,102,'sell','2026-06-29','2026-06-30','74','1417.400024',104888,12,7,104869,NULL,'nestle-sell','Current FY sell of opening quantity',200,'2026-06-30 00:00:00','2026-06-30 00:00:00');
    INSERT INTO investment_prices (id,user_id,asset_id,price_date,price,currency,source,notes,import_batch_id,created_at,updated_at)
      VALUES
        (3000,1,100,'2026-06-30','2450','INR','import','Imported close',200,'2026-06-30 01:00:00','2026-06-30 01:00:00'),
        (3001,1,101,'2026-06-30','310','INR','import','Imported close',200,'2026-06-30 01:00:00','2026-06-30 01:00:00');
    INSERT INTO wealth_import_rows (id,user_id,batch_id,row_number,raw_json,normalized_json,fingerprint,status,created_transaction_id,created_price_id,created_at)
      VALUES
        (4000,1,200,1,'{"row":1}','{"transaction_type":"transfer_in"}','fp-open-tcs','imported',1000,NULL,'2026-04-01 02:00:00'),
        (4001,1,200,2,'{"row":2}','{"transaction_type":"buy"}','fp-buy-tcs','imported',1002,NULL,'2026-04-01 02:01:00'),
        (4002,1,200,3,'{"row":3}','{"transaction_type":"sell"}','fp-sell-tcs','imported',1003,NULL,'2026-05-04 02:00:00'),
        (4003,1,200,4,'{"row":4}','{"price":"2450"}','fp-price-tcs','imported',NULL,3000,'2026-06-30 02:00:00');
  `);
}

function diagnostics(db: string) {
  return rows(db, `
    SELECT 'investment_transactions.user_id' check_name, COUNT(*) failures FROM investment_transactions t LEFT JOIN users u ON u.id=t.user_id WHERE u.id IS NULL
    UNION ALL SELECT 'investment_transactions.account_id', COUNT(*) FROM investment_transactions t LEFT JOIN portfolios p ON p.id=t.account_id WHERE p.id IS NULL
    UNION ALL SELECT 'investment_transactions.asset_id', COUNT(*) FROM investment_transactions t LEFT JOIN investment_assets a ON a.id=t.asset_id WHERE t.asset_id IS NOT NULL AND a.id IS NULL
    UNION ALL SELECT 'investment_transactions.movement_id', COUNT(*) FROM investment_transactions t LEFT JOIN movements m ON m.id=t.movement_id WHERE t.movement_id IS NOT NULL AND m.id IS NULL
    UNION ALL SELECT 'investment_transactions.import_batch_id', COUNT(*) FROM investment_transactions t LEFT JOIN wealth_import_batches b ON b.id=t.import_batch_id WHERE t.import_batch_id IS NOT NULL AND b.id IS NULL
    UNION ALL SELECT 'wealth_import_rows.created_transaction_id', COUNT(*) FROM wealth_import_rows r LEFT JOIN investment_transactions t ON t.id=r.created_transaction_id WHERE r.created_transaction_id IS NOT NULL AND t.id IS NULL
    UNION ALL SELECT 'investment_prices.import_batch_id', COUNT(*) FROM investment_prices p LEFT JOIN wealth_import_batches b ON b.id=p.import_batch_id WHERE p.import_batch_id IS NOT NULL AND b.id IS NULL;
  `);
}

function snapshot(db: string) {
  return rows(db, `
    SELECT 'investment_transactions' table_name, COUNT(*) row_count, GROUP_CONCAT(id, ',') ids, SUM(COALESCE(gross_amount,0)) gross_total, SUM(COALESCE(net_amount,0)) net_total FROM investment_transactions
    UNION ALL SELECT 'investment_prices', COUNT(*), GROUP_CONCAT(id, ','), 0, 0 FROM investment_prices
    UNION ALL SELECT 'wealth_import_batches', COUNT(*), GROUP_CONCAT(id, ','), 0, 0 FROM wealth_import_batches
    UNION ALL SELECT 'wealth_import_rows', COUNT(*), GROUP_CONCAT(id, ','), 0, 0 FROM wealth_import_rows
    UNION ALL SELECT 'movements', COUNT(*), GROUP_CONCAT(id, ','), SUM(amount), 0 FROM movements;
  `);
}

const buggyRebuild = `
  CREATE TABLE investment_transactions_phase9 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    account_id INTEGER NOT NULL REFERENCES portfolios(id),
    asset_id INTEGER REFERENCES investment_assets(id),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('buy','sell','sip','contribution','employer_contribution','employee_contribution','interest','dividend','withdrawal','redemption','maturity','transfer_in','transfer_out','fee','tax','adjustment','bonus','split','charges')),
    trade_date TEXT NOT NULL,
    settlement_date TEXT,
    quantity TEXT,
    unit_price TEXT,
    gross_amount INTEGER,
    charges INTEGER NOT NULL DEFAULT 0,
    taxes INTEGER NOT NULL DEFAULT 0,
    net_amount INTEGER,
    movement_id INTEGER REFERENCES movements(id),
    external_ref TEXT,
    notes TEXT,
    import_batch_id INTEGER REFERENCES wealth_import_batches(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO investment_transactions_phase9 SELECT * FROM investment_transactions;
`;

describe('Phase 9 migration 0016 on populated Wealth data', () => {
  it('reproduces the old SELECT-star rebuild foreign-key failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kotecash-phase9-buggy-'));
    const db = join(dir, 'test.sqlite');
    try {
      applyThrough0015(db);
      seedProductionLikeWealthData(db);
      expect(diagnostics(db).every((r: any) => r.failures === 0)).toBe(true);
      expect(() => sqlite(db, buggyRebuild)).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves populated Wealth imports, prices, movements, and transaction IDs through 0016', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kotecash-phase9-fixed-'));
    const db = join(dir, 'test.sqlite');
    try {
      applyThrough0015(db);
      seedProductionLikeWealthData(db);
      const before = snapshot(db);
      sqlite(db, readFileSync('db/migrations/0016_phase9_manual_valuations.sql', 'utf8'));
      const after = snapshot(db);

      expect(after).toEqual(before);
      expect(rows(db, 'PRAGMA foreign_key_check;')).toEqual([]);
      expect(diagnostics(db).every((r: any) => r.failures === 0)).toBe(true);
      expect(rows(db, `SELECT id, import_batch_id, movement_id, created_at, updated_at FROM investment_transactions WHERE id=1002;`)[0]).toMatchObject({ id: 1002, import_batch_id: 200, movement_id: 30, created_at: '2026-04-02 00:00:00', updated_at: '2026-04-02 00:00:00' });
      expect(rows(db, `SELECT created_transaction_id FROM wealth_import_rows WHERE id IN (4000,4001,4002) ORDER BY id;`).map((r: any) => r.created_transaction_id)).toEqual([1000, 1002, 1003]);
      expect(rows(db, `SELECT COUNT(*) count FROM investment_transactions WHERE transaction_type='transfer_in';`)[0].count).toBe(2);
      expect(rows(db, `SELECT COUNT(*) count FROM investment_transactions WHERE transaction_type IN ('buy','sell');`)[0].count).toBe(3);
      expect(rows(db, `SELECT COUNT(*) count FROM investment_prices;`)[0].count).toBe(2);
      expect(rows(db, `SELECT COUNT(*) count FROM movements;`)[0].count).toBe(1);
      expect(rows(db, `SELECT COUNT(*) count FROM investment_transactions;`)[0].count).toBe(5);

      sqlite(db, `
        INSERT INTO investment_transactions (id,user_id,account_id,asset_id,transaction_type,trade_date,quantity,gross_amount,net_amount,import_batch_id)
          VALUES (1100,1,20,100,'employer_contribution','2026-07-01','1',100,100,200),
                 (1101,1,20,100,'fee','2026-07-02',NULL,10,10,200),
                 (1102,1,20,100,'buy','2026-07-03','1',100,100,200);
        INSERT INTO wealth_valuation_snapshots (id,user_id,account_id,asset_id,valuation_date,invested_value,current_value,source,notes)
          VALUES (5000,1,20,100,'2026-07-14',1000,1200,'manual','Manual migrated snapshot');
        INSERT INTO wealth_valuation_snapshots (id,user_id,account_id,asset_id,valuation_date,invested_value,current_value,accrued_interest,source,notes)
          VALUES (5001,1,20,NULL,'2026-07-14',100000,101000,1000,'formula','Fixed-deposit style account snapshot');
      `);
      expect(rows(db, `SELECT transaction_type FROM investment_transactions WHERE id IN (1100,1101,1102) ORDER BY id;`).map((r: any) => r.transaction_type)).toEqual(['employer_contribution', 'fee', 'buy']);
      expect(rows(db, `SELECT COUNT(*) count FROM wealth_valuation_snapshots;`)[0].count).toBe(2);
      expect(rows(db, `SELECT COUNT(*) count FROM movements;`)[0].count).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
