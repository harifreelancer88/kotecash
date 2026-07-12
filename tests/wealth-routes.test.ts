import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import wealthAccounts from '../src/server/routes/wealth-accounts';
import wealthAssets from '../src/server/routes/wealth-assets';

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
});

describe('wealth assets routes', () => {
  it('creates stock and mutual fund assets, rejects invalid enums and currency', async () => {
    const h = harness(wealthAssets, '/api/wealth/assets', mockDB());
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ABC', asset_type: 'stock', symbol: 'abc', exchange: 'nse' }) }, h.env)).status).toBe(201);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fund', asset_type: 'mutual_fund', scheme_code: '123' }) }, h.env)).status).toBe(201);
    expect((await h.app.request('/api/wealth/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Bad', asset_type: 'crypto' }) }, h.env)).status).toBe(400);
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
    h = harness(wealthAssets, '/api/wealth/assets', mockDB());
    expect((await h.app.request('/api/wealth/assets/3', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'B' }) }, h.env)).status).toBe(404);
    expect((await h.app.request('/api/wealth/assets/3', { method: 'DELETE' }, h.env)).status).toBe(200);
    h = harness(wealthAssets, '/api/wealth/assets', mockDB([{ match: 'FROM investment_assets WHERE user_id=?', rows: [{ id: 1, name: 'Mine' }] }]));
    expect(await (await h.app.request('/api/wealth/assets?active=true&q=mi', {}, h.env)).json()).toEqual([{ id: 1, name: 'Mine' }]);
  });
});
