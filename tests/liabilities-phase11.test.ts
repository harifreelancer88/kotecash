import { describe, expect, it } from 'vitest';
import { expectedEmi, schedule, dueStatus } from '../src/server/wealth/liabilities';

describe('Phase 11 liability calculations', () => {
  it('calculates reducing-balance EMI without NaN or Infinity', () => {
    const emi = expectedEmi(1_000_000, 12, 'monthly', 'reducing', 12);
    expect(Number.isFinite(emi)).toBe(true);
    expect(emi).toBeGreaterThan(0);
  });

  it('supports flat and simple interest estimates', () => {
    expect(expectedEmi(1_200_000, 12, 'monthly', 'flat', 12)).toBe(112000);
    expect(expectedEmi(1_200_000, 12, 'monthly', 'simple', 12)).toBe(112000);
  });

  it('renders an estimated schedule with remaining installments', () => {
    const rows = schedule({ original_principal: 1_000_000, current_outstanding: 1_000_000, interest_rate: 12, interest_type: 'reducing', repayment_frequency: 'monthly', emi_amount: 90_000, start_date: '2026-01-31', maturity_date: '2027-01-31' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].estimate).toBe(true);
    expect(rows.every((r) => Number.isFinite(r.remaining))).toBe(true);
  });

  it('labels due states', () => {
    expect(dueStatus(null)).toBe('no_due_date');
    expect(dueStatus('2000-01-01')).toBe('overdue');
  });
});
