import { describe, it, expect } from 'vitest';
import { accountBalance, pnl, type Movement } from '../src/server/formulas';

// The 6 movements produced by db/backfill.sql (user 1).
const MOV: Movement[] = [
  { date: '2026-06-01', amount: 11774644, category_id: 1, src_kind: null, src_id: null, dst_kind: 'wallet', dst_id: 6 },
  { date: '2026-06-21', amount: 1800000, category_id: 2, src_kind: 'wallet', src_id: 6, dst_kind: 'cicilan', dst_id: 1 },
  { date: '2026-06-22', amount: 500000, category_id: 3, src_kind: 'wallet', src_id: 6, dst_kind: null, dst_id: null },
  { date: '2026-06-21', amount: 150000, category_id: 3, src_kind: 'wallet', src_id: 6, dst_kind: null, dst_id: null },
  { date: '2026-06-22', amount: 150000, category_id: 3, src_kind: 'wallet', src_id: 6, dst_kind: null, dst_id: null },
  { date: '2026-06-22', amount: 150000, category_id: 7, src_kind: 'wallet', src_id: 6, dst_kind: null, dst_id: null },
];

describe('backfill acceptance', () => {
  it('Jago Cahya (6): initial 0 + salary − cicilan − 4 expenses', () => {
    expect(accountBalance('wallet', 6, 0, MOV)).toBe(11774644 - 1800000 - 950000);
  });

  it('opening-balance wallets keep their folded initial_balance (no movements touch them)', () => {
    expect(accountBalance('wallet', 2, 279246, MOV)).toBe(279246); // BCA
    expect(accountBalance('wallet', 4, 634245, MOV)).toBe(634245); // SMBC
    expect(accountBalance('wallet', 5, 137398, MOV)).toBe(137398); // Permata
  });

  it('cicilan (1): sisa = total_utang(1,800,000) − payment(1,800,000) = 0', () => {
    expect(accountBalance('cicilan', 1, 1800000, MOV)).toBe(0);
  });

  it('June P&L now includes the previously-missing 950K expenses (cicilan payment excluded)', () => {
    const r = pnl(MOV, '2026-06');
    expect(r.income).toBe(11774644);
    expect(r.expense).toBe(950000);
  });
});
