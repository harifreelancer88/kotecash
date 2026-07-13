import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import wealthImports from '../src/server/routes/wealth-imports';
import wealthHoldings from '../src/server/routes/wealth-holdings';

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
];

const headers = [
  'account_id','account_name','account_type','institution','asset_name','asset_type','symbol','isin','exchange','scheme_code',
  'transaction_type','trade_date','settlement_date','quantity','unit_price','gross_amount','charges','taxes','net_amount','currency',
  'movement_id','external_ref','notes','price_date','price','price_source',
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

function sqliteD1(db: string): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...values: any[]) {
          const statement = applyBinds(query, values);
          return {
            all: async () => ({ results: JSON.parse(sql(db, statement, true) || '[]') }),
            first: async () => {
              const limited = /\blimit\s+\d+\s*$/i.test(statement.trim()) ? statement : `${statement} LIMIT 1`;
              return JSON.parse(sql(db, limited, true) || '[]')[0] ?? null;
            },
            run: async () => {
              sql(db, `${statement};`);
              const table = /^\s*insert\s+into\s+([a-z_]+)/i.exec(statement)?.[1];
              const meta = JSON.parse(sql(db, `SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name=${quote(table)}),0) AS last_row_id, changes() AS changes;`, true) || '[]')[0] ?? {};
              return { success: true, meta };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function routeHarness(db: D1Database) {
  const h = new Hono<{ Variables: { userId: number } }>();
  h.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  h.route('/api/wealth/imports', wealthImports);
  h.route('/api/wealth/holdings', wealthHoldings);
  return { app: h, env: { DB: db } as any };
}

function row(overrides: Record<string, any>) {
  const base: Record<string, any> = {
    account_id: 2, account_name: 'Zerodha', account_type: 'brokerage', institution: 'Zerodha',
    asset_name: overrides.symbol, asset_type: 'stock', symbol: overrides.symbol, isin: overrides.isin,
    exchange: 'NSE', scheme_code: '', settlement_date: '', charges: 0, taxes: 0, currency: 'INR',
    movement_id: '', notes: '', price_date: '', price: '', price_source: '',
  };
  return { ...base, ...overrides };
}

function csv(rows: Record<string, any>[]) {
  const esc = (v: any) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
}

function seed(db: string) {
  for (const migration of migrations) sql(db, readFileSync(migration, 'utf8'));
  sql(db, `
    INSERT INTO users (id,email,password_hash) VALUES (1,'u@example.com','x');
    INSERT INTO portfolios (id,user_id,name,value,account_type,institution,currency,is_active,valuation_mode)
      VALUES (2,1,'Zerodha',0,'brokerage','Zerodha','INR',1,'holdings');
  `);
  const openings = [
    ['APLAPOLLO','INE702C01027',75], ['BPCL','INE029A01011',172],
    ['NESTLEIND','INE239A01024',74], ['AIIL','INE206F01022',134],
  ];
  for (const [symbol, isin, quantity] of openings) {
    sql(db, `
      INSERT INTO investment_assets (user_id,name,asset_type,symbol,isin,exchange,currency,price_source,pricing_mode)
        VALUES (1,'${symbol}','stock','${symbol}','${isin}','NSE','INR','import','manual');
      INSERT INTO investment_transactions (user_id,account_id,asset_id,transaction_type,trade_date,quantity,unit_price,gross_amount,charges,taxes,net_amount)
        VALUES (1,2,last_insert_rowid(),'transfer_in','2026-03-31','${quantity}','1',${quantity},0,0,${quantity});
    `);
  }
}

function currentFyRows() {
  const rows = [
    row({ symbol: 'TCS', isin: 'INE467B01029', transaction_type: 'buy', trade_date: '2026-04-01', quantity: 57, unit_price: '2415.899902', gross_amount: 137706, net_amount: 137706, external_ref: 'tcs-buy' }),
    row({ symbol: 'TCS', isin: 'INE467B01029', transaction_type: 'sell', trade_date: '2026-05-04', quantity: 57, unit_price: '2457', gross_amount: 140049, net_amount: 140049, external_ref: 'tcs-sell' }),
    row({ symbol: 'APLAPOLLO', isin: 'INE702C01027', transaction_type: 'sell', trade_date: '2026-05-04', quantity: 63, unit_price: '1901.599976', gross_amount: 119801, net_amount: 119801, external_ref: 'open-sell-1' }),
    row({ symbol: 'BPCL', isin: 'INE029A01011', transaction_type: 'sell', trade_date: '2026-05-04', quantity: 124, unit_price: '301.054022', gross_amount: 37331, net_amount: 37331, external_ref: 'open-sell-2' }),
    row({ symbol: 'NESTLEIND', isin: 'INE239A01024', transaction_type: 'sell', trade_date: '2026-06-29', quantity: 74, unit_price: '1417.400024', gross_amount: 104888, net_amount: 104888, external_ref: 'open-sell-3' }),
    row({ symbol: 'AIIL', isin: 'INE206F01022', transaction_type: 'sell', trade_date: '2026-06-01', quantity: 49, unit_price: '472.020404', gross_amount: 23129, net_amount: 23129, external_ref: 'open-sell-4' }),
  ];
  const baseLength = rows.length;
  for (let i = baseLength; i < 56; i++) {
    const n = i - baseLength + 1;
    rows.push(row({ symbol: `NEW${n}`, isin: `INE000000${String(n).padStart(3, '0')}`, transaction_type: 'buy', trade_date: '2026-06-15', quantity: n, unit_price: String(100 + n), gross_amount: n * (100 + n), net_amount: n * (100 + n), external_ref: `new-${n}` }));
  }
  return rows;
}

describe('wealth canonical current-FY import end to end', () => {
  it('previews, commits, and retries a 56-row canonical CSV without movements or duplicate transactions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kotecash-import-'));
    const dbFile = join(dir, 'test.sqlite');
    try {
      seed(dbFile);
      const h = routeHarness(sqliteD1(dbFile));
      const currentFyCsv = csv(currentFyRows());
      const body = new FormData();
      body.append('file', new File([currentFyCsv], 'current-fy.csv', { type: 'text/csv' }));
      body.append('mapping', JSON.stringify({}));
      body.append('options', JSON.stringify({ default_currency: 'INR' }));
      const preview = await h.app.request('/api/wealth/imports/preview', { method: 'POST', body }, h.env);
      expect(preview.status).toBe(200);
      let p: any = await preview.json();
      expect(p).toMatchObject({ total_rows: 56, valid_rows: 56, invalid_rows: 0, duplicate_rows: 0 });
      expect(new Set(p.rows.filter((r: any) => r.asset?.candidate).map((r: any) => r.asset.candidate.isin)).size).toBe(51);

      const del = await h.app.request(`/api/wealth/imports/${p.batch_id}`, { method: 'DELETE' }, h.env);
      expect(del.status).toBe(200);
      expect(await del.json()).toMatchObject({ deleted: true, deleted_rows: 56 });
      const deletedCounts = JSON.parse(sql(dbFile, `SELECT
        (SELECT COUNT(*) FROM wealth_import_rows WHERE batch_id=${p.batch_id}) AS import_rows,
        (SELECT COUNT(*) FROM wealth_import_batches WHERE id=${p.batch_id}) AS batches,
        (SELECT COUNT(*) FROM investment_transactions WHERE import_batch_id=${p.batch_id}) AS imported_tx,
        (SELECT COUNT(*) FROM investment_prices WHERE import_batch_id=${p.batch_id}) AS imported_prices,
        (SELECT COUNT(*) FROM movements) AS movements;`, true))[0];
      expect(deletedCounts).toMatchObject({ import_rows: 0, batches: 0, imported_tx: 0, imported_prices: 0, movements: 0 });

      const secondBody = new FormData();
      secondBody.append('file', new File([currentFyCsv], 'current-fy.csv', { type: 'text/csv' }));
      secondBody.append('mapping', JSON.stringify({}));
      secondBody.append('options', JSON.stringify({ default_currency: 'INR' }));
      const secondPreview = await h.app.request('/api/wealth/imports/preview', { method: 'POST', body: secondBody }, h.env);
      expect(secondPreview.status).toBe(200);
      p = await secondPreview.json();
      expect(p).toMatchObject({ total_rows: 56, valid_rows: 56, invalid_rows: 0, duplicate_rows: 0 });

      const commit = await h.app.request(`/api/wealth/imports/${p.batch_id}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ create_missing_assets: true }),
      }, h.env);
      expect(commit.status).toBe(200);
      expect(await commit.json()).toMatchObject({ imported_rows: 56, skipped_rows: 0, failed_rows: 0 });

      const retry = await h.app.request(`/api/wealth/imports/${p.batch_id}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ create_missing_assets: true }),
      }, h.env);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ imported_rows: 0, skipped_rows: 56, failed_rows: 0 });

      const retryWithoutAssetCreation = await h.app.request(`/api/wealth/imports/${p.batch_id}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }, h.env);
      expect(retryWithoutAssetCreation.status).toBe(200);
      expect(await retryWithoutAssetCreation.json()).toMatchObject({ imported_rows: 0, skipped_rows: 56, failed_rows: 0 });

      const counts = JSON.parse(sql(dbFile, `SELECT
        (SELECT COUNT(*) FROM investment_transactions WHERE import_batch_id=${p.batch_id}) AS imported_tx,
        (SELECT COUNT(*) FROM movements) AS movements,
        (SELECT COUNT(*) FROM categories WHERE type='expense') AS expense_categories,
        (SELECT imported_rows FROM wealth_import_batches WHERE id=${p.batch_id}) AS batch_imported_rows;`, true))[0];
      expect(counts).toMatchObject({ imported_tx: 56, movements: 0, expense_categories: 0, batch_imported_rows: 56 });

      const holdings = await h.app.request('/api/wealth/holdings?include_closed=true&as_of=2026-07-01', {}, h.env);
      const hj: any = await holdings.json();
      const tcs = hj.holdings.find((r: any) => r.symbol === 'TCS');
      expect(tcs.quantity).toBe('0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000);
});
