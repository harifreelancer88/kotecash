import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import wealthAccounts from '../src/server/routes/wealth-accounts';
import wealthAssets from '../src/server/routes/wealth-assets';
import wealthTransactions from '../src/server/routes/wealth-transactions';
import wealthValuationSnapshots from '../src/server/routes/wealth-valuation-snapshots';

function mockDB(rowsByQuery: { match: string; rows?: any[]; first?: any; run?: any }[] = []) {
  const prepare = vi.fn((query: string) => {
    const hit = rowsByQuery.find((r) => query.includes(r.match));
    const rows = hit?.rows ?? [];
    const first = hit?.first ?? null;
    const run = hit?.run ?? { success: true, meta: { last_row_id: 7, changes: 1 } };
    return { bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: rows })), first: vi.fn(async () => first), run: vi.fn(async () => run) })) };
  });
  return { prepare } as unknown as D1Database;
}
function harness(route: any, mount: string, db: D1Database) {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  app.route(mount, route);
  return { app, env: { DB: db } as any };
}

describe('wealth accounts routes', () => {
  it('lists accounts for current user using portfolio valuation', async () => {
    const db = mockDB([
      { match: 'FROM portfolios WHERE user_id=?', rows: [{ id: 3, name: 'Legacy', value: 100, account_type: 'other', is_active: 1 }] },
      { match: 'FROM balance_history', rows: [{ entity_kind: 'portfolio', entity_id: 3, amount: 1000, recorded_at: '2026-07-01 00:00:00' }] },
      { match: 'FROM movements', rows: [{ src_kind: 'portfolio', src_id: 3, dst_kind: 'wallet', dst_id: 1, amount: 100, date: '2026-07-05' }] },
    ]);
    const { app, env } = harness(wealthAccounts, '/api/wealth/accounts', db);
    const res = await app.request('/api/wealth/accounts', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([{ id: 3, currentValue: 900 }]);
  });

  it('rejects invalid create inputs and duplicate active account names', async () => {
    let h = harness(wealthAccounts, '/api/wealth/accounts', mockDB());
    expect((await h.app.request('/api/wealth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ' ', account_type: 'other' }) }, h.env)).status).toBe(400);
    expect((await h.app.request('/api/wealth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', account_type: 'bad' }) }, h.env)).status).toBe(400);
    expect((await h.app.request('/api/wealth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', valuation_mode: 'bad' }) }, h.env)).status).toBe(400);
    expect((await h.app.request('/api/wealth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', currency: 'USDT' }) }, h.env)).status).toBe(400);
    h = harness(wealthAccounts, '/api/wealth/accounts', mockDB([{ match: 'lower(name)=lower', first: { id: 1 } }]));
    expect((await h.app.request('/api/wealth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A' }) }, h.env)).status).toBe(400);
  });

  it('creates, updates owned, rejects other user, and soft-deletes', async () => {
    let h = harness(wealthAccounts, '/api/wealth/accounts', mockDB());
    expect((await h.app.request('/api/wealth/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Broker', opening_value: 0 }) }, h.env)).status).toBe(201);
    h = harness(wealthAccounts, '/api/wealth/accounts', mockDB([{ match: 'SELECT id FROM portfolios WHERE id=?', first: { id: 7 } }]));
    expect((await h.app.request('/api/wealth/accounts/7', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Broker 2', is_active: false }) }, h.env)).status).toBe(200);
    h = harness(wealthAccounts, '/api/wealth/accounts', mockDB());
    expect((await h.app.request('/api/wealth/accounts/8', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nope' }) }, h.env)).status).toBe(404);
    expect((await h.app.request('/api/wealth/accounts/7', { method: 'DELETE' }, h.env)).status).toBe(200);
  });

  it('permanently deletes only empty owned accounts and reports dependencies when blocked', async () => {
    let h = harness(wealthAccounts, '/api/wealth/accounts', mockDB([
      { match: 'SELECT id, name, institution', first: { id: 7, name: 'Empty' } },
      { match: '(SELECT COUNT(*) FROM investment_assets', first: { assets: 0, transactions: 0, prices: 0, snapshots: 0, import_rows: 0, import_transactions: 0, movements: 0, legacy_balance_history: 0, earmarks: 0, locked_net_worth_snapshots: 0 } },
      { match: 'DELETE FROM portfolios', run: { success: true, meta: { changes: 1 } } },
    ]));
    let res = await h.app.request('/api/wealth/accounts/7/permanent', { method: 'DELETE' }, h.env);
    expect(res.status).toBe(200);
    h = harness(wealthAccounts, '/api/wealth/accounts', mockDB([
      { match: 'SELECT id, name, institution', first: { id: 8, name: 'Broker' } },
      { match: '(SELECT COUNT(*) FROM investment_assets', first: { assets: 1, transactions: 73, prices: 17, snapshots: 0, import_rows: 0, import_transactions: 73, movements: 1, legacy_balance_history: 1, earmarks: 0, locked_net_worth_snapshots: 0 } },
    ]));
    res = await h.app.request('/api/wealth/accounts/8/permanent', { method: 'DELETE' }, h.env);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ can_delete: false, dependencies: { assets: 1, transactions: 73 } });
  });
});

describe('wealth assets routes', () => {
  it('creates stock and mutual fund assets, rejects invalid enums and currency', async () => {
    const h = harness(wealthAssets, '/api/wealth/assets', mockDB());
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ABC', asset_type: 'stock', symbol: 'abc', exchange: 'nse' }) }, h.env)).status).toBe(201);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fund', asset_type: 'mutual_fund', scheme_code: '123' }) }, h.env)).status).toBe(201);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Crypto', asset_type: 'crypto' }) }, h.env)).status).toBe(201);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad', price_source: 'x' }) }, h.env)).status).toBe(400);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad', pricing_mode: 'x' }) }, h.env)).status).toBe(400);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad', currency: 'R' }) }, h.env)).status).toBe(400);
  });

  it('rejects duplicate identifiers, updates owned, rejects another user, soft-deletes, and isolates list', async () => {
    let h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'WHERE user_id=? AND isin=?', first: { id: 1 } }]));
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dup', isin: 'INE123' }) }, h.env)).status).toBe(400);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'WHERE user_id=? AND scheme_code=?', first: { id: 1 } }]));
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dup', scheme_code: '1' }) }, h.env)).status).toBe(400);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'symbol=? AND exchange=?', first: { id: 1 } }]));
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dup', asset_type: 'stock', symbol: 'A', exchange: 'NSE' }) }, h.env)).status).toBe(400);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'SELECT * FROM investment_assets', first: { id: 2, name: 'A', asset_type: 'stock' } }]));
    expect((await h.app.request('/api/wealth/assets/2', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B' }) }, h.env)).status).toBe(200);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'SELECT id, isin', first: { id: 3 } }, { match: 'CASE WHEN EXISTS', first: { has_transactions: 0, has_prices: 0 } }]));
    expect((await h.app.request('/api/wealth/assets/3', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B' }) }, h.env)).status).toBe(404);
    expect((await h.app.request('/api/wealth/assets/3', { method: 'DELETE' }, h.env)).status).toBe(200);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'FROM investment_assets WHERE user_id=?', rows: [{ id: 1, name: 'Mine' }] }]));
    expect(await (await h.app.request('/api/wealth/assets?active=true&q=mi', {}, h.env)).json()).toEqual([{ id: 1, name: 'Mine' }]);
  });
});


describe('wealth transaction money convention', () => {
  it('preserves whole-unit INR integer amounts in API writes', async () => {
    const inserted: any[][] = [];
    const db = {
      prepare: vi.fn((query: string) => ({
        bind: vi.fn((...args: any[]) => ({
          first: vi.fn(async () => {
            if (query.includes('FROM portfolios')) return { id: 1, is_active: 1 };
            if (query.includes('FROM investment_assets')) return { id: 2, is_active: 1 };
            return null;
          }),
          all: vi.fn(async () => ({ results: [] })),
          run: vi.fn(async () => { inserted.push(args); return { success: true, meta: { last_row_id: 9, changes: 1 } }; }),
        })),
      })),
    } as unknown as D1Database;
    const h = harness(wealthTransactions, '/api/wealth/transactions', db);
    const res = await h.app.request('/api/wealth/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: 1, asset_id: 2, transaction_type: 'buy', trade_date: '2026-07-12', quantity: '1', unit_price: '10000', gross_amount: 10000, charges: 0, taxes: 0, net_amount: 10000, external_ref: 'controlled-10000' }) }, h.env);
    expect(res.status).toBe(201);
    expect(inserted[0]).toContain(10000);
    expect(inserted[0].filter((v) => v === 10000)).toHaveLength(2);
  });
});

describe('wealth asset safe deactivation', () => {
  it('blocks referenced assets and allows unreferenced duplicate assets to deactivate', async () => {
    let h = harness(wealthAssets, '/api/wealth/assets', mockDB([
      { match: 'SELECT id, isin', first: { id: 1, isin: 'INE467B01029' } },
      { match: 'CASE WHEN EXISTS', first: { has_transactions: 1, has_prices: 0 } },
    ]));
    let res = await h.app.request('/api/wealth/assets/1', { method: 'DELETE' }, h.env);
    expect(res.status).toBe(400);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([
      { match: 'SELECT id, isin', first: { id: 2, isin: 'INE467B01029' } },
      { match: 'CASE WHEN EXISTS', first: { has_transactions: 0, has_prices: 0 } },
      { match: 'UPDATE investment_assets', run: { success: true, meta: { changes: 1 } } },
    ]));
    res = await h.app.request('/api/wealth/assets/2', { method: 'DELETE' }, h.env);
    expect(res.status).toBe(200);
  });
});

describe('wealth permanent asset deletion', () => {
  it('deletes empty assets and blocks referenced assets with a dependency report', async () => {
    let h = harness(wealthAssets, '/api/wealth/assets', mockDB([
      { match: 'SELECT id FROM investment_assets', first: { id: 9 } },
      { match: '(SELECT COUNT(*) FROM investment_transactions', first: { transactions: 0, prices: 0, snapshots: 0, import_rows: 0, import_transactions: 0, import_prices: 0, movements: 0, holdings: 0 } },
      { match: 'DELETE FROM investment_assets', run: { success: true, meta: { changes: 1 } } },
    ]));
    let res = await h.app.request('/api/wealth/assets/9/permanent', { method: 'DELETE' }, h.env);
    expect(res.status).toBe(200);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([
      { match: 'SELECT id FROM investment_assets', first: { id: 10 } },
      { match: '(SELECT COUNT(*) FROM investment_transactions', first: { transactions: 1, prices: 1, snapshots: 0, import_rows: 0, import_transactions: 1, import_prices: 1, movements: 0, holdings: 1 } },
    ]));
    res = await h.app.request('/api/wealth/assets/10/permanent', { method: 'DELETE' }, h.env);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ can_delete: false, dependencies: { transactions: 1, prices: 1 } });
  });
});

describe('wealth legacy valuation migration route', () => {
  it('previews, requires confirmation, and creates one account snapshot without movements', async () => {
    const db = mockDB([
      { match: 'SELECT id,name,account_type', first: { id: 5, name: 'ICICI test', account_type: 'epf', valuation_mode: 'manual_snapshot', value: 0 } },
      { match: 'SELECT COUNT(*) count FROM wealth_valuation_snapshots', first: { count: 0 } },
      { match: 'SELECT id,amount,recorded_at FROM balance_history', first: { id: 44, amount: 125000, recorded_at: '2026-07-14 00:00:00' } },
      { match: 'SELECT id,current_value,source FROM wealth_valuation_snapshots', first: null },
      { match: 'INSERT INTO wealth_valuation_snapshots', run: { success: true, meta: { last_row_id: 88, changes: 1 } } },
    ]);
    const h = harness(wealthValuationSnapshots, '/api/wealth/valuation-snapshots', db);
    let res = await h.app.request('/api/wealth/valuation-snapshots/legacy-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: 5 }) }, h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ account_name: 'ICICI test', current_value: 125000, source: 'legacy_balance_history' });
    res = await h.app.request('/api/wealth/valuation-snapshots/from-legacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: 5, valuation_date: '2026-07-14' }) }, h.env);
    expect(res.status).toBe(400);
    res = await h.app.request('/api/wealth/valuation-snapshots/from-legacy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: 5, valuation_date: '2026-07-14', confirm: true }) }, h.env);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ id: 88, created: true });
    expect((db.prepare as any).mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO movements'))).toBe(false);
  });
});
