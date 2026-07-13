import { describe, expect, it, vi } from 'vitest';
import { aggregateTradesByOrder, calculateCutoverOpeningPositions } from '../src/server/wealth/cutover';

describe('FY cutover calculations', () => {
  it('calculates FIFO opening quantity and remaining whole-INR cost basis', () => {
    const out = calculateCutoverOpeningPositions([
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'buy', trade_date: '2025-04-01', quantity: '10', unit_price: '100', gross_amount: 1000 },
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'buy', trade_date: '2025-05-01', quantity: '10', unit_price: '200', gross_amount: 2000 },
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'sell', trade_date: '2025-06-01', quantity: '12', unit_price: '250', gross_amount: 3000 },
    ]);
    expect(out.can_commit).toBe(true);
    expect(out.opening_positions).toHaveLength(1);
    expect(out.opening_positions[0]).toMatchObject({ trade_date: '2026-03-31', transaction_type: 'transfer_in', quantity: '8', gross_amount: 1600, net_amount: 1600, movement_id: null });
  });

  it('omits zero closed positions and blocks unresolved oversells', () => {
    const closed = calculateCutoverOpeningPositions([
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'buy', trade_date: '2025-04-01', quantity: '5', gross_amount: 500 },
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'sell', trade_date: '2025-04-02', quantity: '5', gross_amount: 600 },
    ]);
    expect(closed.opening_positions).toHaveLength(0);
    expect(closed.closed_positions).toHaveLength(1);
    const bad = calculateCutoverOpeningPositions([{ account_id: 1, asset_id: 2, symbol: 'XYZ', transaction_type: 'sell', trade_date: '2025-04-02', quantity: '1', gross_amount: 100 }]);
    expect(bad.can_commit).toBe(false);
    expect(bad.unresolved[0].errors[0]).toContain('Unresolved oversell');
  });

  it('aggregates executions by order with weighted average price', () => {
    const rows = aggregateTradesByOrder([
      { trade_date: '2026-04-02', external_ref: 'O1', symbol: 'ABC', isin: 'INE1', exchange: 'NSE', transaction_type: 'buy', quantity: '2', unit_price: '10', notes: 'T1' },
      { trade_date: '2026-04-02', external_ref: 'O1', symbol: 'ABC', isin: 'INE1', exchange: 'NSE', transaction_type: 'buy', quantity: '3', unit_price: '20', notes: 'T2' },
      { trade_date: '2026-04-02', external_ref: 'O1', symbol: 'ABC', isin: 'INE1', exchange: 'NSE', transaction_type: 'sell', quantity: '1', unit_price: '30' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quantity: '5', gross_amount: 80, unit_price: '16', external_ref: 'O1' });
  });
});

import { Hono } from 'hono';
import wealthCutover, { CUTOVER_PREVIEW_BATCH_INSERT, CUTOVER_PREVIEW_ROW_INSERT } from '../src/server/routes/wealth-cutover';

function countPlaceholders(sql: string) { return (sql.match(/\?/g) || []).length; }
function listedColumns(sql: string) { return sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((s) => s.trim()).filter(Boolean); }
function routeHarness(db: D1Database) {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  app.route('/api/wealth/cutover', wealthCutover);
  return { app, env: { DB: db } as any };
}
function cutoverMockDB() {
  const calls: { query: string; values: any[] }[] = [];
  const prepare = vi.fn((query: string) => ({
    bind: vi.fn((...values: any[]) => {
      calls.push({ query, values });
      return {
        all: vi.fn(async () => {
          if (query.includes('investment_assets')) return { results: [{ id: 11, name: 'Acme Ltd', asset_type: 'stock' }] };
          if (query.includes('investment_transactions')) return { results: [] };
          return { results: [] };
        }),
        first: vi.fn(async () => {
          if (query.includes('FROM portfolios')) return { id: 10, name: 'Brokerage', account_type: 'brokerage' };
          return null;
        }),
        run: vi.fn(async () => ({ success: true, meta: { last_row_id: 42, changes: 1 } })),
      };
    }),
  }));
  return { db: { prepare } as unknown as D1Database, calls };
}

describe('FY cutover preview route', () => {
  it('stores previous/current FY CSV previews without creating final finance records', async () => {
    const { db, calls } = cutoverMockDB();
    const h = routeHarness(db);
    const csv = 'symbol,isin,trade_date,trade_type,quantity,price\nACME,INEACME,2025-05-01,buy,10,100\nACME,INEACME,2025-06-01,sell,4,100\n';
    const cur = 'symbol,isin,trade_date,trade_type,quantity,price\nACME,INEACME,2026-04-02,buy,1,110\n';
    const fd = new FormData();
    fd.append('previous_tradebook', new File([csv], 'previous.csv', { type: 'text/csv' }));
    fd.append('current_tradebook', new File([cur], 'current.csv', { type: 'text/csv' }));
    fd.append('account_id', '10');
    fd.append('cutover_date', '2026-04-01');
    fd.append('mapping', JSON.stringify({ symbol: 'symbol', isin: 'isin', trade_date: 'trade_date', trade_type: 'transaction_type', quantity: 'quantity', price: 'unit_price' }));

    const res = await h.app.request('/api/wealth/cutover/preview', { method: 'POST', body: fd }, h.env);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.preview_id).toBe(42);
    expect(body.total_rows).toBe(2);
    expect(calls.some((c) => c.query === CUTOVER_PREVIEW_BATCH_INSERT)).toBe(true);
    expect(calls.filter((c) => c.query === CUTOVER_PREVIEW_ROW_INSERT)).toHaveLength(2);
    expect(calls.some((c) => /^INSERT INTO investment_transactions/i.test(c.query))).toBe(false);
    expect(calls.some((c) => /^INSERT INTO investment_prices/i.test(c.query))).toBe(false);
    expect(calls.some((c) => /^INSERT INTO movements/i.test(c.query))).toBe(false);
    expect(calls.some((c) => /^INSERT INTO portfolios/i.test(c.query))).toBe(false);
    expect(calls.some((c) => /^INSERT INTO investment_assets/i.test(c.query))).toBe(false);
  });

  it('keeps cutover preview INSERT column, placeholder, and bind counts aligned', async () => {
    expect(listedColumns(CUTOVER_PREVIEW_BATCH_INSERT)).toHaveLength(8);
    expect(countPlaceholders(CUTOVER_PREVIEW_BATCH_INSERT)).toBe(8);
    expect(listedColumns(CUTOVER_PREVIEW_ROW_INSERT)).toHaveLength(10);
    expect(countPlaceholders(CUTOVER_PREVIEW_ROW_INSERT)).toBe(10);

    const { db, calls } = cutoverMockDB();
    const h = routeHarness(db);
    const fd = new FormData();
    fd.append('previous_tradebook', new File(['symbol,isin,trade_date,trade_type,quantity,price\nACME,INEACME,2025-05-01,buy,1,100\n'], 'previous.csv', { type: 'text/csv' }));
    fd.append('account_id', '10');
    fd.append('mapping', JSON.stringify({ symbol: 'symbol', isin: 'isin', trade_date: 'trade_date', trade_type: 'transaction_type', quantity: 'quantity', price: 'unit_price' }));

    const res = await h.app.request('/api/wealth/cutover/preview', { method: 'POST', body: fd }, h.env);
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.query === CUTOVER_PREVIEW_BATCH_INSERT)?.values).toHaveLength(8);
    expect(calls.find((c) => c.query === CUTOVER_PREVIEW_ROW_INSERT)?.values).toHaveLength(10);
  });
});
