import { describe, expect, it } from 'vitest';
import { movementBuckets, CASH_FLOW_DEFINITIONS } from '../src/server/budget-service';

describe('Phase 14 budget and cash-flow rules', () => {
  const categories = [
    { id: 1, type: 'income', classification: 'income' },
    { id: 2, type: 'expense', classification: 'variable' },
    { id: 3, type: 'expense', classification: 'discretionary' },
    { id: 4, type: 'expense', classification: 'investment' },
  ];
  it('excludes transfers and investment contributions from ordinary expenses', () => {
    const parts = movementBuckets([
      { amount: 1000, src_kind: null, dst_kind: 'wallet', category_id: 1 },
      { amount: 250, src_kind: 'wallet', dst_kind: null, category_id: 2 },
      { amount: 100, src_kind: 'wallet', dst_kind: 'wallet', category_id: null },
      { amount: 200, src_kind: 'wallet', dst_kind: 'portfolio', category_id: 4 },
    ], categories as any);
    expect(parts.income).toBe(1000);
    expect(parts.ordinaryExpenses).toBe(250);
    expect(parts.transfers).toBe(300);
    expect(parts.investmentContributions).toBe(200);
  });
  it('deduplicates liability payments from ordinary expenses', () => {
    const parts = movementBuckets([
      { amount: 300, src_kind: 'wallet', dst_kind: 'cicilan', category_id: 2 },
      { amount: 80, src_kind: 'credit_card', dst_kind: null, category_id: 3 },
    ], categories as any);
    expect(parts.debtPayments).toBe(300);
    expect(parts.ordinaryExpenses).toBe(80);
  });
  it('documents savings rate zero-income behavior as null in monthly API definitions', () => {
    expect(CASH_FLOW_DEFINITIONS.savingsRate).toContain('null when income is zero');
  });
});
