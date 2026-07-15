import { describe, expect, it } from 'vitest';
import { inflationAdjustment, plan, scenario, validateGoal } from '../src/server/wealth/goals';

const base = { id:1, name:'Education', goal_type:'child_education', target_amount:100000, target_date:'2027-07-15', start_date:'2026-07-15', current_manual_amount:25000, funding_mode:'manual', priority:'high', status:'active', inflation_rate:6, expected_return_rate:0, monthly_contribution_override:null, include_existing_assets:1, metadata_json:null };

describe('financial goals Phase 12 calculations', () => {
  it('validates goal types, positive targets, dates, and finite rates', () => {
    expect(() => validateGoal(base)).not.toThrow();
    expect(() => validateGoal({ ...base, target_amount: 0 })).toThrow(/positive/);
    expect(() => validateGoal({ ...base, target_date:'2026-01-01' })).toThrow(/before start/);
    expect(() => validateGoal({ ...base, expected_return_rate: Infinity })).toThrow(/expected_return_rate/);
  });

  it('calculates inflation adjusted targets with partial years without overwriting base target', () => {
    const out = inflationAdjustment({ ...base, target_date:'2027-01-15' }, '2026-07-15')!;
    expect(out.base_target).toBe(100000);
    expect(out.inflation_adjusted_target).toBeGreaterThan(100000);
    expect(out.years_remaining).toBeGreaterThan(0.49);
    expect(out.estimate).toBe(true);
  });

  it('calculates zero-return, already-funded, expired, and missing-date monthly plans', () => {
    expect(plan({ ...base, inflation_rate:null, expected_return_rate:0 }, 40000, '2026-07-15').required_monthly_contribution).toBeGreaterThan(0);
    expect(plan({ ...base, inflation_rate:null }, 120000, '2026-07-15').status).toBe('already_funded');
    expect(plan({ ...base, target_date:'2026-01-01', inflation_rate:null }, 1, '2026-07-15').status).toBe('target_date_passed');
    expect(plan({ ...base, target_date:null, inflation_rate:null }, 1, '2026-07-15').status).toBe('missing_target_date');
  });

  it('returns scenario estimates and does not guarantee returns', () => {
    const out = scenario(base, 25000, { monthly_contribution: 10000, expected_return_rate: 8 }, '2026-07-15');
    expect(out.projected_amount).toBeGreaterThan(25000);
    expect(out.assumptions.not_guaranteed).toBe(true);
  });
});
