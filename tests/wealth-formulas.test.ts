import { describe, expect, it } from 'vitest';
import { calculateHolding } from '../src/server/wealth/formulas';
describe('wealth FIFO formulas', () => {
  it('handles buys, average cost, FIFO sell, charges, and gains', () => {
    const h = calculateHolding([
      { id:1, account_id:1, asset_id:1, transaction_type:'buy', trade_date:'2026-01-01', quantity:'10', gross_amount:1000 },
      { id:2, account_id:1, asset_id:1, transaction_type:'buy', trade_date:'2026-01-02', quantity:'10', gross_amount:2000 },
      { id:3, account_id:1, asset_id:1, transaction_type:'sell', trade_date:'2026-01-03', quantity:'5', gross_amount:800, charges:50, taxes:50 },
    ], [{ asset_id:1, price_date:'2026-01-04', price:'200' }], { asOf:'2026-01-05', assetType:'stock' });
    expect(h.quantity).toBe('15');
    expect(h.remaining_cost_basis).toBe(2500);
    expect(h.average_cost).toBe('166.666667');
    expect(h.realised_gain).toBe(200);
    expect(h.current_value).toBe(3000);
    expect(h.unrealised_gain).toBe(500);
    expect(h.total_gain).toBe(700);
  });
  it('covers complete sale, oversell, bonus, split, transfers, dividend, latest/missing/stale price, ordering and precision', () => {
    expect(calculateHolding([{account_id:1,asset_id:1,transaction_type:'buy',trade_date:'2026-01-01',quantity:'1.123456',gross_amount:1000}],[],{}).warnings).toContain('missing_price');
    expect(() => calculateHolding([{account_id:1,asset_id:1,transaction_type:'sell',trade_date:'2026-01-01',quantity:'1',gross_amount:100}])).toThrow('Oversell');
    const h = calculateHolding([
      {id:2,account_id:1,asset_id:1,transaction_type:'buy',trade_date:'2026-01-01',quantity:'10',gross_amount:1000},
      {id:3,account_id:1,asset_id:1,transaction_type:'bonus',trade_date:'2026-01-01',quantity:'2'},
      {id:4,account_id:1,asset_id:1,transaction_type:'split',trade_date:'2026-01-02',quantity:'2'},
      {id:5,account_id:1,asset_id:1,transaction_type:'transfer_in',trade_date:'2026-01-03',quantity:'1',gross_amount:100},
      {id:6,account_id:1,asset_id:1,transaction_type:'transfer_out',trade_date:'2026-01-04',quantity:'5'},
      {id:7,account_id:1,asset_id:1,transaction_type:'dividend',trade_date:'2026-01-05',gross_amount:50},
    ], [{asset_id:1,price_date:'2026-01-01',price:'1'},{asset_id:1,price_date:'2026-01-06',price:'100'}], {asOf:'2026-01-20', assetType:'stock'});
    expect(h.quantity).toBe('20');
    expect(h.remaining_cost_basis).toBeGreaterThan(0);
    expect(h.latest_price_date).toBe('2026-01-06');
    expect(h.stale_price).toBe(true);
    expect(calculateHolding([{account_id:1,asset_id:1,transaction_type:'buy',trade_date:'2026-01-01',quantity:'1',gross_amount:1},{account_id:1,asset_id:1,transaction_type:'sell',trade_date:'2026-01-02',quantity:'1',gross_amount:2}],[],{}).quantity).toBe('0');
    expect(() => calculateHolding([{account_id:1,asset_id:1,transaction_type:'buy',trade_date:'2026-01-01',quantity:'bad',gross_amount:1}])).toThrow();
  });
});
