import { describe, expect, it } from 'vitest';
import { confidence, expectedAmount, includeActualIncome, nextDates, statusForDate, validateSourceInput } from '../src/server/income-service';

describe('Phase 20 income planning helpers', () => {
  it('validates supported income types, non-negative finite amounts, ownership-friendly dates, and salary days', () => {
    expect(validateSourceInput({ name:'Salary', income_type:'salary', expected_amount:0, frequency:'monthly', expected_day:31, start_date:'2026-01-01', end_date:'2026-12-31' })).toEqual([]);
    expect(validateSourceInput({ name:'Bad', income_type:'salary', expected_amount:Number.POSITIVE_INFINITY })).toContain('expected_amount must be non-negative finite');
    expect(validateSourceInput({ name:'Bad', income_type:'salary', salary_day:32 })).toContain('salary_day must be between 1 and 31');
    expect(validateSourceInput({ name:'Bad', income_type:'crypto_airdrop' })).toContain('Unsupported income_type');
    expect(validateSourceInput({ name:'Bad', income_type:'salary', start_date:'2026-12-31', end_date:'2026-01-01' })).toContain('end_date cannot precede start_date');
  });

  it('generates bounded deterministic dates for monthly, weekly, quarterly, yearly, and one-time sources', () => {
    expect(nextDates({ id:1, frequency:'monthly', expected_day:31, start_date:'2026-01-01' }, '2026-01-01', '2026-03-31')).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
    expect(nextDates({ id:1, frequency:'weekly' }, '2026-01-01', '2026-01-15')).toEqual(['2026-01-01','2026-01-08','2026-01-15']);
    expect(nextDates({ id:1, frequency:'quarterly', expected_day:15 }, '2026-01-01', '2026-08-31')).toEqual(['2026-01-15','2026-04-15','2026-07-15']);
    expect(nextDates({ id:1, frequency:'yearly', expected_day:1 }, '2026-01-01', '2027-02-01')).toEqual(['2026-01-01','2027-01-01']);
    expect(nextDates({ id:1, frequency:'one_time', expected_payment_date:'2026-05-20' }, '2026-05-01', '2026-05-31')).toEqual(['2026-05-20']);
    expect(nextDates({ id:1, frequency:'irregular' }, '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('supports salary net credit and variable conservative/base/optimistic estimates without NaN', () => {
    expect(expectedAmount({ income_type:'salary', expected_amount:100, expected_net_credit:80 })).toBe(80);
    expect(expectedAmount({ income_type:'freelance', conservative_estimate:50, base_estimate:100, optimistic_estimate:150 }, '2026-01-01', 'conservative')).toBe(50);
    expect(expectedAmount({ income_type:'freelance', conservative_estimate:50, base_estimate:100, optimistic_estimate:150 }, '2026-01-01', 'base')).toBe(100);
    expect(expectedAmount({ income_type:'freelance', conservative_estimate:50, base_estimate:100, optimistic_estimate:150 }, '2026-01-01', 'optimistic')).toBe(150);
    expect(Number.isFinite(expectedAmount({ income_type:'bonus' }))).toBe(true);
  });

  it('classifies due states and matching confidence, requiring low confidence to remain only a suggestion', () => {
    expect(statusForDate('2026-07-15','2026-07-15')).toBe('due_today');
    expect(statusForDate('2026-07-10','2026-07-15')).toBe('overdue');
    expect(statusForDate('2026-07-20','2026-07-15')).toBe('due_soon');
    const src:any = { linked_wallet_id:1, linked_category_id:2, institution_or_payer:'Acme', employer:'Acme' };
    const occ:any = { expected_date:'2026-07-31', expected_amount:1000 };
    expect(confidence(src, occ, { amount:1000, date:'2026-07-31', dst_kind:'wallet', dst_id:1, category_id:2, description:'ACME payroll' })).toBe('exact');
    expect(confidence(src, occ, { amount:600, date:'2026-06-01', dst_kind:'wallet', dst_id:9, category_id:3, description:'unknown' })).toBe('low');
  });

  it('excludes reimbursements, refunds, loan proceeds, transfers, and investment redemptions from clean actual income', () => {
    expect(includeActualIncome({ src_kind:null, dst_kind:'wallet', description:'Monthly salary', category_type:'income' })).toBe(true);
    expect(includeActualIncome({ src_kind:null, dst_kind:'wallet', description:'Reimbursement travel', category_type:'income' })).toBe(false);
    expect(includeActualIncome({ src_kind:null, dst_kind:'wallet', description:'Refund grocery', category_type:'income' })).toBe(false);
    expect(includeActualIncome({ src_kind:null, dst_kind:'wallet', description:'Loan proceeds', category_type:'income' })).toBe(false);
    expect(includeActualIncome({ src_kind:'wallet', dst_kind:'wallet', description:'Internal transfer', category_type:'income' })).toBe(false);
    expect(includeActualIncome({ src_kind:null, dst_kind:'wallet', description:'Investment redemption', category_type:'income' })).toBe(false);
  });
});
