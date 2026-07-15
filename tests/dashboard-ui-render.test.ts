import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function context() {
  const c = createContext({
    Intl, Number, String, Math,
    URLSearchParams,
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    window: { addEventListener() {}, location: { href: '', search: '' }, history: { pushState() {} }, scrollTo() {} },
    console, fetch() { throw new Error('not called'); },
  });
  new Script(readFileSync('public/app.js', 'utf8')).runInContext(c);
  return c as any;
}

describe('premium dashboard rendering', () => {
  it('renders hero, metrics, income, alerts, actions, modules, upcoming and activity with INR formatting', () => {
    const c = context();
    c.M.incomeSummary = { actual_income: 10000, expected_income: 0, income_variance: 10000, next_expected_credit: null };
    c.M.financialOverview = {
      net_worth: { current_live_net_worth: 1204212, latest_snapshot_month: '2026-07', valuation_status: 'complete', month_on_month_change: null, month_on_month_percentage: null, year_to_date_change: 125000, year_to_date_percentage: 12, trend: [{ month: '2026-07', net_worth: 1204212 }] },
      cash_flow: { income: 10000, ordinary_expenses: 3308, savings_rate: .42, projected_month_end_result: 6692, investment_contributions: 1304212, debt_payments: 2455, top_spending_category: { name: 'Shopping' } },
      wealth: { current_investment_value: 1304212, total_gain_loss: 10000, xirr: .123 },
      liabilities: { total_outstanding: 100000, monthly_emi_commitment: 2455, overdue_amount: 0 },
      goals: { active_goals: 2, goals_behind: 1, monthly_contribution_required: 10000 },
      budgets: { remaining_budget: 25000, used_percentage: 64, exceeded_categories: [1], approaching_limit_categories: [] },
      alerts: { initial_items: [{ severity: 'critical', title: 'Budget exceeded', explanation: 'Shopping is over budget by ₹3,308.', destination_path: '/?page=budgets' }] },
      upcoming: [{ title: 'EMI due', type: 'emi', date: '2026-07-20', amount: 2455 }],
      recent_activity: [{ title: 'Coffee', source_type: 'PennyWise', date_time: '2026-07-15', status: 'synced', amount: 70 }],
      imports: { unresolved_rows: 0 }, pennywise: { failed_sync_count: 0 }, health: {}, meta: { partial: false }
    };
    const html = c.renderDashboard();
    expect(html).toContain('dashboard-hero');
    expect(html).toContain('Net Worth');
    expect(html).toContain('₹12,04,212');
    expect(html).toContain('₹10,000');
    expect(html).toContain('₹3,308');
    expect(html).toContain('₹13,04,212');
    expect(html).toContain('₹1,00,000');
    expect(html).toContain('₹2,455');
    expect(html).toContain('Needs Attention');
    expect(html).toContain('High');
    expect(html).toContain('Quick Actions');
    expect(html).toContain('Upcoming');
    expect(html).toContain('Recent Activity');
    expect(html).toContain('₹70');
    expect(html).not.toContain('Rp');
    expect(html).not.toMatch(/₹\d{1,3}(?:\.\d{3})+/);
  });

  it('renders null and empty states without misleading comparisons', () => {
    const c = context();
    c.M.financialOverview = { net_worth: {}, cash_flow: {}, wealth: {}, liabilities: {}, goals: {}, budgets: {}, alerts: {}, imports: {}, pennywise: {}, health: {}, meta: {} };
    const html = c.renderDashboard();
    expect(html).toContain('No comparison');
    expect(html).toContain('No attention items right now.');
    expect(html).toContain('No dated items in the next 30 days.');
    expect(html).toContain('No recent activity.');
    expect(html).toContain('aria-label="Notifications"');
  });

  it('renders Family tabs without leaking the dashboard helper scope', () => {
    const c = context();
    c.M.householdSummary = {
      household: { name: 'Default household', household_type: 'family' },
      household_net_worth: 1210874,
      total_assets: 1310874,
      total_liabilities: 100000,
      joint_assets: 0,
      joint_liabilities: 0,
      shared_household_value: 0,
      member_wise_net_worth: [
        { member: { id: 1, display_name: 'Self', relationship: 'self' }, member_net_worth: 1210874, member_assets: 1310874, member_liabilities: 100000, goals: [] },
      ],
      unallocated_records: [],
      ownership_warnings: [],
    };
    expect(() => c.renderFamily()).not.toThrow();
    const household = c.renderFamily();
    expect(household).toContain('Default household');
    c.window.location.search = '?page=family&familyTab=summary';
    expect(c.renderFamily()).toContain('Self');
  });

  it('maps safe route aliases to existing renderers and wealth tabs', () => {
    const c = context();
    c.window.location.search = '?page=reconciliation';
    expect(c.pageFromUrl()).toBe('reconcile');
    c.window.location.search = '?page=settings';
    expect(c.pageFromUrl()).toBe('api');
    c.window.location.search = '?page=holdings';
    expect(c.pageFromUrl()).toBe('wealth');
    expect(c.WEALTH_PAGE_TAB_ALIASES.holdings).toBe('holdings');
    c.window.location.search = '?page=definitely-missing';
    expect(c.pageFromUrl()).toBe('definitely-missing');
  });
});
