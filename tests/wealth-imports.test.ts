import { describe, expect, it } from 'vitest';
import { fingerprint, normalizeImportRow, validateMapping } from '../src/server/wealth/imports';

describe('wealth import helpers', () => {
  it('validates header mapping', () => expect(validateMapping({Date:'trade_date'}, ['Date'])).toEqual({Date:'trade_date'}));
  it('rejects duplicate canonical mapping', () => expect(()=>validateMapping({A:'trade_date',B:'trade_date'}, ['A','B'])).toThrow(/Duplicate/));
  it('normalizes row values', () => { const n=normalizeImportRow({Date:'2026-01-01',Type:'Buy',Qty:'1.25',CCY:'inr'}, {Date:'trade_date',Type:'transaction_type',Qty:'quantity',CCY:'currency'}).normalized; expect(n.transaction_type).toBe('buy'); expect(n.currency).toBe('INR'); expect(n.quantity).toBe('1.25'); });
  it('rejects invalid date', () => expect(()=>normalizeImportRow({Date:'01/01/2026',Type:'buy'}, {Date:'trade_date',Type:'transaction_type'})).toThrow(/date/));
  it('rejects invalid decimal', () => expect(()=>normalizeImportRow({Qty:'x',Type:'buy'}, {Qty:'quantity',Type:'transaction_type'})).toThrow());
  it('rejects invalid money', () => expect(()=>normalizeImportRow({Amt:'12.3',Type:'buy'}, {Amt:'gross_amount',Type:'transaction_type'})).toThrow(/gross_amount/));
  it('creates deterministic fingerprints', async () => { const n={transaction_type:'buy',trade_date:'2026-01-01',quantity:'1',unit_price:'2',gross_amount:2,charges:0,taxes:0,net_amount:2}; const a={id:1}; const s={id:2}; await expect(fingerprint(1,n,a,s)).resolves.toBe(await fingerprint(1,n,a,s)); });
});
