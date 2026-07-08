import { describe, it, expect } from 'vitest';
import {
  walletEarmarked,
  walletFree,
  goalProgress,
  savingsRate,
  dtiRatio,
  budgetStatus,
  ccUtilizationColor,
  amortizationSchedule,
  newScenario,
  accountBalance,
  portfolioValue,
  pnl,
} from '../src/server/formulas';

describe('formulas', () => {
  describe('walletEarmarked', () => {
    it('returns 0 when no earmarks match wallet source type and id', () => {
      const earmarks = [
        { goal_id: 1, source_type: 'deposit', source_id: 1, amount: 500 },
        { goal_id: 2, source_type: 'wallet', source_id: 2, amount: 300 },
      ];
      expect(walletEarmarked(1, earmarks)).toBe(0);
    });

    it('sums matching wallet earmarks', () => {
      const earmarks = [
        { goal_id: 1, source_type: 'wallet', source_id: 1, amount: 200 },
        { goal_id: 2, source_type: 'wallet', source_id: 1, amount: 300 },
        { goal_id: 3, source_type: 'deposit', source_id: 1, amount: 500 },
        { goal_id: 4, source_type: 'wallet', source_id: 2, amount: 400 },
      ];
      expect(walletEarmarked(1, earmarks)).toBe(500);
    });
  });

  describe('walletFree', () => {
    it('returns balance minus earmarked', () => {
      expect(walletFree(1000, 300)).toBe(700);
      expect(walletFree(500, 600)).toBe(-100);
    });
  });

  describe('goalProgress', () => {
    it('returns 0 when no earmarks match goal id', () => {
      const earmarks = [
        { goal_id: 2, source_type: 'wallet', source_id: 1, amount: 300 },
      ];
      expect(goalProgress(1, earmarks)).toBe(0);
    });

    it('sums all earmarks matching the goal id', () => {
      const earmarks = [
        { goal_id: 1, source_type: 'wallet', source_id: 1, amount: 200 },
        { goal_id: 1, source_type: 'deposit', source_id: 2, amount: 300 },
        { goal_id: 2, source_type: 'wallet', source_id: 1, amount: 400 },
      ];
      expect(goalProgress(1, earmarks)).toBe(500);
    });
  });

  describe('savingsRate', () => {
    it('returns correct fraction for standard cases', () => {
      expect(savingsRate(1000, 700)).toBeCloseTo(0.3);
      expect(savingsRate(1000, 1000)).toBe(0);
      expect(savingsRate(1000, 1200)).toBeCloseTo(-0.2);
    });

    it('returns 0 for zero or negative income', () => {
      expect(savingsRate(0, 500)).toBe(0);
      expect(savingsRate(-100, 500)).toBe(0);
    });
  });

  describe('dtiRatio', () => {
    it('returns correct debt-to-income ratio', () => {
      expect(dtiRatio(1000, 300)).toBeCloseTo(0.3);
      expect(dtiRatio(1000, 0)).toBe(0);
    });

    it('returns 0 for zero or negative income', () => {
      expect(dtiRatio(0, 300)).toBe(0);
      expect(dtiRatio(-100, 300)).toBe(0);
    });
  });

  describe('budgetStatus', () => {
    it('returns OVER when spending is greater than budget', () => {
      expect(budgetStatus(101, 100)).toBe('OVER');
    });

    it('returns ON TRACK when spending is between 90% and 100% of budget inclusive', () => {
      expect(budgetStatus(91, 100)).toBe('ON TRACK');
      expect(budgetStatus(100, 100)).toBe('ON TRACK');
    });

    it('returns UNDER when spending is 90% or less of budget', () => {
      expect(budgetStatus(90, 100)).toBe('UNDER');
      expect(budgetStatus(50, 100)).toBe('UNDER');
      expect(budgetStatus(0, 100)).toBe('UNDER');
    });

    it('handles zero or negative budgets correctly', () => {
      expect(budgetStatus(10, 0)).toBe('OVER');
      expect(budgetStatus(0, 0)).toBe('UNDER');
      expect(budgetStatus(0, -10)).toBe('UNDER');
      expect(budgetStatus(10, -5)).toBe('OVER');
    });
  });

  describe('ccUtilizationColor', () => {
    it('returns green when utilization is 30% or less', () => {
      expect(ccUtilizationColor(30, 100)).toBe('green');
      expect(ccUtilizationColor(20, 100)).toBe('green');
    });

    it('returns amber when utilization is between 30% exclusive and 50% inclusive', () => {
      expect(ccUtilizationColor(31, 100)).toBe('amber');
      expect(ccUtilizationColor(50, 100)).toBe('amber');
    });

    it('returns red when utilization is above 50%', () => {
      expect(ccUtilizationColor(51, 100)).toBe('red');
    });

    it('handles zero or negative limits', () => {
      expect(ccUtilizationColor(10, 0)).toBe('red');
      expect(ccUtilizationColor(0, 0)).toBe('green');
      expect(ccUtilizationColor(0, -100)).toBe('green');
      expect(ccUtilizationColor(10, -100)).toBe('red');
    });
  });

  describe('amortizationSchedule', () => {
    it('generates correct schedule', () => {
      const schedule = amortizationSchedule(12000000, 12, 1000000, 12);
      expect(schedule).toHaveLength(12);

      // Verify first month
      // sisa = 12000000, rate = 0.01 -> interest = 120000, principal = 880000, remaining = 11120000
      expect(schedule[0]).toEqual({
        month: 1,
        monthly: 1000000,
        interestPayment: 120000,
        principalPayment: 880000,
        remaining: 11120000,
      });

      // Verify last month remaining is exactly 0
      expect(schedule[11].remaining).toBe(0);
      // Principal payment in the last month should equal the remaining balance before that month
      const prevRemaining = schedule[10].remaining;
      expect(schedule[11].principalPayment).toBe(prevRemaining);
      expect(schedule[11].interestPayment).toBe(1000000 - prevRemaining);
    });

    it('returns empty list if monthsLeft is zero or negative', () => {
      expect(amortizationSchedule(12000000, 12, 1000000, 0)).toHaveLength(0);
      expect(amortizationSchedule(12000000, 12, 1000000, -5)).toHaveLength(0);
    });
  });

  describe('newScenario', () => {
    it('calculates the what-if scenario values correctly', () => {
      const result = newScenario(10000, 8000, 10, -10, 3000);
      expect(result.newIncome).toBe(11000);
      expect(result.newExpense).toBe(7200);
      expect(result.newNet).toBe(3800);
      expect(result.newSR).toBeCloseTo(3800 / 11000);
      expect(result.newDTI).toBeCloseTo(3000 / 11000);
    });

    it('handles negative change percentages', () => {
      const result = newScenario(10000, 8000, -20, 20, 3000);
      expect(result.newIncome).toBe(8000);
      expect(result.newExpense).toBe(9600);
      expect(result.newNet).toBe(-1600);
      expect(result.newSR).toBeCloseTo(-1600 / 8000);
      expect(result.newDTI).toBeCloseTo(3000 / 8000);
    });

    it('handles zero income in scenario without division by zero', () => {
      const result = newScenario(0, 8000, 10, 10, 3000);
      expect(result.newIncome).toBe(0);
      expect(result.newExpense).toBe(8800);
      expect(result.newNet).toBe(-8800);
      expect(result.newSR).toBe(0);
      expect(result.newDTI).toBe(0);
    });
  });

  describe('accountBalance', () => {
    const M = (over: Partial<any>) => ({
      src_kind: null, src_id: null, dst_kind: null, dst_id: null, amount: 0, date: '2026-06-01', ...over,
    });
    it('wallet: base + income(dst) - expense(src)', () => {
      const mv = [M({ dst_kind: 'wallet', dst_id: 1, amount: 500 }),
                  M({ src_kind: 'wallet', src_id: 1, amount: 200 })];
      expect(accountBalance('wallet', 1, 1000, mv)).toBe(1300);
    });
    it('wallet: ignores movements on other accounts', () => {
      const mv = [M({ dst_kind: 'wallet', dst_id: 2, amount: 999 })];
      expect(accountBalance('wallet', 1, 1000, mv)).toBe(1000);
    });
    it('deposit: principal in(dst) - withdrawal(src)', () => {
      const mv = [M({ dst_kind: 'deposit', dst_id: 3, amount: 10000000 }),
                  M({ src_kind: 'deposit', src_id: 3, amount: 2000000 })];
      expect(accountBalance('deposit', 3, 0, mv)).toBe(8000000);
    });
    it('cicilan: total_utang(base) - payments(dst)', () => {
      const mv = [M({ dst_kind: 'cicilan', dst_id: 5, amount: 1800000 })];
      expect(accountBalance('cicilan', 5, 5000000, mv)).toBe(3200000);
    });
    it('credit_card: owed = charges(src) - payments(dst)', () => {
      const mv = [M({ src_kind: 'credit_card', src_id: 9, amount: 500 }),
                  M({ dst_kind: 'credit_card', dst_id: 9, amount: 300 })];
      expect(accountBalance('credit_card', 9, 0, mv)).toBe(200);
    });
  });

  describe('portfolioValue', () => {
    it('returns latest snapshot minus outflows since that snapshot', () => {
      const snaps = [
        { entity_kind: 'portfolio', entity_id: 7, amount: 1000, recorded_at: '2026-06-01 00:00:00' },
        { entity_kind: 'portfolio', entity_id: 7, amount: 1500, recorded_at: '2026-07-01 00:00:00' },
      ];
      const mv = [
        { src_kind: 'portfolio', src_id: 7, amount: 100, date: '2026-06-15', dst_kind: 'wallet', dst_id: 1 },
        { src_kind: 'portfolio', src_id: 7, amount: 250, date: '2026-07-10', dst_kind: 'wallet', dst_id: 1 },
      ];
      expect(portfolioValue(7, snaps, mv)).toBe(1250);
    });
    it('returns 0 when no snapshot exists', () => {
      expect(portfolioValue(7, [], [])).toBe(0);
    });
  });

  describe('pnl', () => {
    // Defaults use a non-null sentinel so only an explicit `null` override makes an
    // end "outside" — keeps income (src NULL) and expense (dst NULL) distinguishable.
    const M = (over: Partial<any>) => ({
      src_kind: 'wallet', src_id: 1, dst_kind: 'wallet', dst_id: 2,
      amount: 0, date: '2026-06-15', category_id: null, ...over,
    });
    it('income = src NULL; expense = dst NULL; debt payments excluded', () => {
      const mv = [
        M({ src_kind: null, src_id: null, amount: 1000, date: '2026-06-10' }),
        M({ dst_kind: null, dst_id: null, amount: 400, date: '2026-06-12', category_id: 3 }),
        M({ dst_kind: 'cicilan', dst_id: 5, amount: 500, date: '2026-06-20' }),
      ];
      const r = pnl(mv, '2026-06');
      expect(r.income).toBe(1000);
      expect(r.expense).toBe(400);
    });
    it('excludes other months', () => {
      const mv = [M({ src_kind: null, src_id: null, amount: 1000, date: '2026-05-10' })];
      expect(pnl(mv, '2026-06').income).toBe(0);
    });
  });
});
