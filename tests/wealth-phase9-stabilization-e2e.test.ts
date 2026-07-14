import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import wealthAccounts from '../src/server/routes/wealth-accounts';
import wealthAssets from '../src/server/routes/wealth-assets';
import wealthValuationSnapshots from '../src/server/routes/wealth-valuation-snapshots';

const migrations = [
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
  'db/migrations/0016_phase9_manual_valuations.sql',
];

function sql(db: string, text: string, json = false) {
  return execFileSync('sqlite3', json ? ['-json', db] : [db], { input: text, encoding: 'utf8' });
}
function quote(v: any) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}
function applyBinds(query: string, values: any[]) {
  let i = 0;
  return query.replace(/\?/g, () => quote(values[i++]));
}
function sqliteD1(db: string, trace: string[] = []): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...values: any[]) {
          const statement = applyBinds(query, values);
          trace.push(statement);
          return {
            all: async () => ({ results: JSON.parse(sql(db, statement, true) || '[]') }),
            first: async () => {
              const limited = /\blimit\s+\d+\s*$/i.test(statement.trim()) ? statement : `${statement} LIMIT 1`;
              return JSON.parse(sql(db, limited, true) || '[]')[0] ?? null;
            },
            run: async () => {
              sql(db, `${statement};`);
              const table = /^\s*insert\s+into\s+([a-z_]+)/i.exec(statement)?.[1];
              const changed = /^\s*(delete|update)\s+/i.test(statement) ? 1 : 0;
              const meta = JSON.parse(sql(db, `SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name=${quote(table)}),0) AS last_row_id, ${changed} AS changes;`, true) || '[]')[0] ?? {};
              return { success: true, meta };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}
function harness(db: D1Database) {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  app.route('/api/wealth/accounts', wealthAccounts);
  app.route('/api/wealth/assets', wealthAssets);
  app.route('/api/wealth/valuation-snapshots', wealthValuationSnapshots);
  return { app, env: { DB: db } as any };
}

describe('Phase 9.1 populated stabilization smoke', () => {
  it('handles legacy EPF provenance, migration, and empty permanent deletes without stock or ledger side effects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kotecash-phase91-'));
    const dbFile = join(dir, 'test.sqlite');
    try {
      for (const migration of migrations) sql(dbFile, readFileSync(migration, 'utf8'));
      sql(dbFile, `
        INSERT INTO users (id,email,password_hash) VALUES (1,'owner@example.com','hash');
        INSERT INTO portfolios (id,user_id,name,value,account_type,institution,is_active,include_in_net_worth,valuation_mode)
          VALUES (1,1,'Legacy EPF',0,'epf','ICICI',1,1,'manual_snapshot'),
                 (2,1,'Zerodha',0,'brokerage','Zerodha',1,1,'holdings'),
                 (3,1,'Empty EPF',0,'epf','Test',1,1,'manual_snapshot');
        INSERT INTO balance_history (id,user_id,entity_kind,entity_id,amount,recorded_at)
          VALUES (10,1,'portfolio',1,125000,'2026-07-14 00:00:00');
        INSERT INTO investment_assets (id,user_id,asset_type,name,symbol,exchange,currency,price_source,pricing_mode,is_active,account_id)
          VALUES (20,1,'stock','Demo Stock','DEMO','NSE','INR','manual','manual',1,2),
                 (21,1,'gold','Unused Gold',NULL,NULL,'INR','manual','not_priced',1,NULL);
        INSERT INTO investment_transactions (id,user_id,account_id,asset_id,transaction_type,trade_date,quantity,gross_amount,net_amount)
          VALUES (30,1,2,20,'buy','2026-07-01','10',1000,1000);
        INSERT INTO investment_prices (id,user_id,asset_id,price_date,price,currency,source)
          VALUES (40,1,20,'2026-07-14','120','INR','manual');
      `);
      const trace: string[] = [];
      const h = harness(sqliteD1(dbFile, trace));
      let accounts = await (await h.app.request('/api/wealth/accounts', {}, h.env)).json() as any[];
      expect(accounts.find((a) => a.id === 1)).toMatchObject({ currentValue: 125000, valuation_source: 'legacy_balance_history' });
      expect(accounts.find((a) => a.id === 2)).toMatchObject({ currentValue: 1200, valuation_source: 'holdings' });

      let res = await h.app.request('/api/wealth/valuation-snapshots/from-legacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: 1, valuation_date: '2026-07-14', confirm: true }) }, h.env);
      expect(res.status).toBe(201);
      accounts = await (await h.app.request('/api/wealth/accounts', {}, h.env)).json() as any[];
      expect(accounts.find((a) => a.id === 1)).toMatchObject({ currentValue: 125000, valuation_source: 'manual_snapshot' });

      expect(JSON.parse(sql(dbFile, 'SELECT COUNT(*) count FROM portfolios WHERE id=3 AND user_id=1;', true))[0].count).toBe(1);
      res = await h.app.request('/api/wealth/accounts/3/permanent', { method: 'DELETE' }, h.env);
      if (res.status !== 200) throw new Error(`${await res.text()}\n${trace.slice(-8).join('\n')}`);
      res = await h.app.request('/api/wealth/accounts/2/permanent', { method: 'DELETE' }, h.env);
      expect(res.status).toBe(409);
      res = await h.app.request('/api/wealth/assets/21/permanent', { method: 'DELETE' }, h.env);
      expect(res.status).toBe(200);
      expect(JSON.parse(sql(dbFile, 'SELECT COUNT(*) count FROM investment_transactions;', true))[0].count).toBe(1);
      expect(JSON.parse(sql(dbFile, 'SELECT COUNT(*) count FROM movements;', true))[0].count).toBe(0);
      expect(JSON.parse(sql(dbFile, 'SELECT COUNT(*) count FROM wealth_valuation_snapshots;', true))[0].count).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
