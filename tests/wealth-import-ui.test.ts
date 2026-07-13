import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function loadWI(doc: any = { getElementById: () => null, querySelectorAll: () => [] }) {
  const context = createContext({ setTimeout, fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }), confirm: () => true, document: doc, module: { exports: {} }, globalThis: {} });
  new Script(readFileSync('public/js/wealth-import.js', 'utf8')).runInContext(context);
  return context.module.exports as any;
}

const openingRow = (cost: any) => ({ row_number: 1, status: 'valid', normalized: { account: { name: 'RGC298' }, asset: { symbol: 'ABC', isin: 'INE000000000' }, transaction_type: 'transfer_in', trade_date: '2026-03-31', quantity: '17', unit_price: cost, gross_amount: cost, net_amount: cost } });

describe('wealth import history/details UI helpers', () => {
  it('history eligibility renders View-capable imported rollback batches through helpers', () => {
    expect(loadWI().canCommitBatch({ status: 'previewed' })).toBe(true);
    expect(loadWI().canRollbackBatch({ status: 'imported' })).toBe(true);
  });
  it('details render includes transfer_in opening row display fields', () => {
    const html = loadWI().rowsTable({ batch: { total_rows: 1 }, rows: [openingRow('12.34')], row_total: 1 });
    expect(html).toContain('transfer_in');
    expect(html).toContain('2026-03-31');
    expect(html).toContain('17');
    expect(html).toContain('12.34');
    expect(html).toContain('RGC298');
    expect(html).toContain('ABC');
    expect(html).toContain('INE000000000');
  });
  it('zero-cost warning appears and commit is disabled without override', () => {
    const WI = loadWI();
    const html = WI.summary({ batch: { id: 7, status: 'previewed', total_rows: 1 }, can_commit: true, rows: [openingRow('0')], row_total: 1 });
    expect(WI.hasZeroCostTransferIn({ rows: [openingRow(null)] })).toBe(true);
    expect(html).toContain('Opening cost basis missing');
    expect(html).toContain('disabled');
    expect(html).toContain('realised gain and XIRR will be inaccurate');
  });
  it('commit is enabled with valid cost basis', () => {
    const html = loadWI().summary({ batch: { id: 7, status: 'validated', total_rows: 1 }, can_commit: true, rows: [openingRow('100')], row_total: 1 });
    expect(html).toContain('data-cm="7"');
    expect(html).not.toContain('Opening cost basis missing');
    expect(html).toContain('data-cm="7" >Commit</button>');
  });
  it('shows Delete only for safely deletable batches', () => {
    const WI = loadWI();
    expect(WI.canDeleteBatch({ status: 'previewed', imported_rows: 0, can_delete: 1 })).toBe(true);
    expect(WI.canDeleteBatch({ status: 'previewed', imported_rows: 0, can_delete: 0 })).toBe(false);
    expect(WI.canDeleteBatch({ status: 'imported', imported_rows: 56, can_delete: 0 })).toBe(false);
    const deletable = WI.summary({ batch: { id: 10, status: 'previewed', total_rows: 56, imported_rows: 0, can_delete: 1 }, can_commit: true, rows: [], row_total: 56 });
    expect(deletable).toContain('Delete eligible');
    expect(deletable).toContain('data-del="10"');
    expect(deletable).toContain('>Delete</button>');
    const imported = WI.summary({ batch: { id: 11, status: 'imported', total_rows: 56, imported_rows: 56, can_delete: 0 }, can_commit: false, rows: [], row_total: 56 });
    expect(imported).not.toContain('data-del="11"');
  });
  it('pagination controls reflect row totals', () => {
    const html = loadWI().rowsTable({ batch: { id: 7, total_rows: 60 }, rows: [openingRow('1')], row_total: 60 });
    expect(html).toContain('Page 1 of 3');
    expect(html).toContain('data-page="2"');
  });
  it('backend errors are displayed safely by row table escaping', () => {
    const html = loadWI().rowsTable({ batch: { total_rows: 1 }, rows: [{ row_number: 2, status: 'failed', error_message: '<script>alert(1)</script>', normalized: {} }], row_total: 1 });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
