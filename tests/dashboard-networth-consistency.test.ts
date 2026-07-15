import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import dashboard from '../src/server/routes/dashboard';
import networth from '../src/server/routes/networth';

function mockDb() {
  const prepare = vi.fn((query: string) => ({
    bind: vi.fn((...args: any[]) => ({
      all: vi.fn(async () => {
        if (query.includes('FROM wallets')) return { results: [{ id: 1, name: 'Cash', type: 'bank', initial_balance: 6662 }] };
        if (query.includes('FROM movements')) {
          const cutoff = args.find((a) => typeof a === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a));
          const rows = [
            { src_kind: null, src_id: null, dst_kind: 'wallet', dst_id: 1, amount: 10000, date: '2026-07-10', category_id: 1 },
            { src_kind: 'wallet', src_id: 1, dst_kind: null, dst_id: null, amount: 6662, date: '2026-07-20', category_id: 2 },
          ];
          return { results: cutoff ? rows.filter((r) => r.date <= cutoff) : rows };
        }
        if (query.includes('FROM portfolios WHERE user_id=?')) return { results: [
          { id: 1, name: 'Zerodha', account_type: 'brokerage', is_active: 1, include_in_net_worth: 1, valuation_mode: 'holdings', value: 0 },
          { id: 2, name: 'EPF', account_type: 'epf', is_active: 1, include_in_net_worth: 1, valuation_mode: 'manual_snapshot', value: 125000 },
        ] };
        if (query.includes('FROM investment_transactions')) return { results: [
          { id: 1, account_id: 1, asset_id: 1, transaction_type: 'buy', trade_date: '2026-06-01', quantity: '1', gross_amount: 1179212, asset_type: 'stock', pricing_mode: 'manual' },
        ] };
        if (query.includes('FROM investment_prices')) return { results: [{ asset_id: 1, price_date: '2026-07-14', price: '1179212' }] };
        if (query.includes('FROM balance_history')) return { results: [{ id: 1, entity_kind: 'portfolio', entity_id: 2, amount: 125000, recorded_at: '2026-07-01 00:00:00' }] };
        if (query.includes('FROM liabilities WHERE')) return { results: [{ id: 1, name: 'Personal loan', liability_type: 'personal_loan', status: 'active', include_in_net_worth: 1, current_outstanding: 100000, original_principal: 100000, auto_calculation_mode: 'manual' }] };
        if (query.includes('FROM liability_balance_snapshots') || query.includes('FROM liability_payments')) return { results: [] };
        if (query.includes('FROM net_worth_snapshots')) return { results: [] };
        return { results: [] };
      }),
      first: vi.fn(async () => null),
      run: vi.fn(async () => ({ success: true, meta: { last_row_id: 1 } })),
    })),
  }));
  return { prepare } as unknown as D1Database;
}

function app(db: D1Database) {
  const a = new Hono<{ Variables: { userId: number } }>();
  a.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  a.route('/api', dashboard);
  a.route('/api/net-worth', networth);
  return { app: a, env: { DB: db } as any };
}

describe('dashboard and net worth consistency', () => {
  it('uses the same current live reconstruction and excludes future current-month movements', async () => {
    const h = app(mockDb());
    const dashboardRes = await h.app.request('/api/dashboard/financial-overview?month=2026-07', {}, h.env);
    const netWorthRes = await h.app.request('/api/net-worth', {}, h.env);
    const dashboardJson: any = await dashboardRes.json();
    const netWorthJson: any = await netWorthRes.json();

    expect(dashboardJson.net_worth.current_live_net_worth).toBe(netWorthJson.current.netWorth);
    expect(dashboardJson.net_worth.reconciliation).toMatchObject({
      wallet_cash: 16662,
      wealth_investments: 1304212,
      liabilities: 100000,
      total: 1220874,
    });
    expect(dashboardJson.wealth.current_investment_value).toBe(1304212);
    expect(dashboardJson.wealth.market_holdings_value).toBe(1179212);
    expect(dashboardJson.wealth.other_investment_value).toBe(125000);
  });
});
