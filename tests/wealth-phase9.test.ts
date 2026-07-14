import { describe, expect, it } from 'vitest';
import { fixedDepositValue } from '../src/server/wealth/fixed-deposit';
import { ACCOUNT_TYPES, ASSET_TYPES, VALUATION_MODES } from '../src/server/wealth/types';

describe('wealth phase 9 type support', () => {
  it('includes expanded account, asset, and valuation modes', () => {
    expect(ACCOUNT_TYPES).toEqual(expect.arrayContaining(['brokerage','mutual_fund','epf','nps','ppf','ssy','fixed_deposit','gold','bond','crypto','other']));
    expect(ASSET_TYPES).toEqual(expect.arrayContaining(['stock','mutual_fund','epf','nps','ppf','ssy','fixed_deposit','gold','bond','crypto','cash_equivalent','other']));
    expect(VALUATION_MODES).toEqual(expect.arrayContaining(['holdings','manual_snapshot','formula','hybrid']));
  });
});

describe('fixed deposit formula valuation', () => {
  it('calculates simple interest, caps at maturity, and uses maturity override', () => {
    const simple = fixedDepositValue({ principal: 100000, interest_rate: 10, start_date: '2024-01-01', maturity_date: '2026-01-01', compounding_frequency: 'simple' }, '2025-01-01');
    expect(simple.value).toBeGreaterThan(109900);
    expect(simple.value).toBeLessThan(110200);
    const override = fixedDepositValue({ principal: 100000, interest_rate: 10, start_date: '2024-01-01', maturity_date: '2025-01-01', compounding_frequency: 'quarterly', maturity_amount: 111111 }, '2026-01-01');
    expect(override.value).toBe(111111);
    expect(override.assumptions).toContain('maturity_amount_override=true');
  });
  it('handles quarterly compounding and leap-year partial periods', () => {
    const v = fixedDepositValue({ principal: 100000, interest_rate: 12, start_date: '2024-02-29', maturity_date: '2025-02-28', compounding_frequency: 'quarterly' }, '2024-08-29');
    expect(v.value).toBeGreaterThan(105800);
    expect(v.value).toBeLessThan(106300);
  });
  it('requires manual valuation when metadata is insufficient and returns no value before start', () => {
    expect(fixedDepositValue({ principal: 100000 }, '2026-01-01').status).toBe('manual_required');
    expect(fixedDepositValue({ principal: 100000, interest_rate: 7, start_date: '2026-01-01' }, '2025-12-31').value).toBe(0);
  });
});
