import { describe, expect, it } from 'vitest';
import { aggregateTradesByOrder, calculateCutoverOpeningPositions } from '../src/server/wealth/cutover';

describe('FY cutover calculations', () => {
  it('calculates FIFO opening quantity and remaining whole-INR cost basis', () => {
    const out = calculateCutoverOpeningPositions([
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'buy', trade_date: '2025-04-01', quantity: '10', unit_price: '100', gross_amount: 1000 },
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'buy', trade_date: '2025-05-01', quantity: '10', unit_price: '200', gross_amount: 2000 },
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'sell', trade_date: '2025-06-01', quantity: '12', unit_price: '250', gross_amount: 3000 },
    ]);
    expect(out.can_commit).toBe(true);
    expect(out.opening_positions).toHaveLength(1);
    expect(out.opening_positions[0]).toMatchObject({ trade_date: '2026-03-31', transaction_type: 'transfer_in', quantity: '8', gross_amount: 1600, net_amount: 1600, movement_id: null });
  });

  it('omits zero closed positions and blocks unresolved oversells', () => {
    const closed = calculateCutoverOpeningPositions([
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'buy', trade_date: '2025-04-01', quantity: '5', gross_amount: 500 },
      { account_id: 1, asset_id: 1, symbol: 'ABC', transaction_type: 'sell', trade_date: '2025-04-02', quantity: '5', gross_amount: 600 },
    ]);
    expect(closed.opening_positions).toHaveLength(0);
    expect(closed.closed_positions).toHaveLength(1);
    const bad = calculateCutoverOpeningPositions([{ account_id: 1, asset_id: 2, symbol: 'XYZ', transaction_type: 'sell', trade_date: '2025-04-02', quantity: '1', gross_amount: 100 }]);
    expect(bad.can_commit).toBe(false);
    expect(bad.unresolved[0].errors[0]).toContain('Unresolved oversell');
  });

  it('aggregates executions by order with weighted average price', () => {
    const rows = aggregateTradesByOrder([
      { trade_date: '2026-04-02', external_ref: 'O1', symbol: 'ABC', isin: 'INE1', exchange: 'NSE', transaction_type: 'buy', quantity: '2', unit_price: '10', notes: 'T1' },
      { trade_date: '2026-04-02', external_ref: 'O1', symbol: 'ABC', isin: 'INE1', exchange: 'NSE', transaction_type: 'buy', quantity: '3', unit_price: '20', notes: 'T2' },
      { trade_date: '2026-04-02', external_ref: 'O1', symbol: 'ABC', isin: 'INE1', exchange: 'NSE', transaction_type: 'sell', quantity: '1', unit_price: '30' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ quantity: '5', gross_amount: 80, unit_price: '16', external_ref: 'O1' });
  });
});
