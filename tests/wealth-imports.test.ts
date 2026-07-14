import { describe, expect, it } from 'vitest';
import { fingerprint, normalizeImportRow, resolveAccount, resolveAsset, validateMapping } from '../src/server/wealth/imports';

describe('wealth import helpers', () => {
  it('validates header mapping', () => expect(validateMapping({Date:'trade_date'}, ['Date'])).toEqual({Date:'trade_date'}));
  it('identity-maps canonical CSV headers without manual mapping', () => expect(validateMapping({}, ['account_id','trade_date','transaction_type'])).toEqual({account_id:'account_id',trade_date:'trade_date',transaction_type:'transaction_type'}));
  it('lets manual mappings override matching canonical headers', () => expect(validateMapping({Date:'trade_date'}, ['trade_date','Date'])).toEqual({Date:'trade_date'}));
  it('rejects duplicate canonical mapping', () => expect(()=>validateMapping({A:'trade_date',B:'trade_date'}, ['A','B'])).toThrow(/Duplicate/));
  it('normalizes row values', () => { const n=normalizeImportRow({Date:'2026-01-01',Type:'Buy',Qty:'1.25',CCY:'inr'}, {Date:'trade_date',Type:'transaction_type',Qty:'quantity',CCY:'currency'}).normalized; expect(n.transaction_type).toBe('buy'); expect(n.currency).toBe('INR'); expect(n.quantity).toBe('1.25'); });
  it('rejects invalid date', () => expect(()=>normalizeImportRow({Date:'01/01/2026',Type:'buy'}, {Date:'trade_date',Type:'transaction_type'})).toThrow(/date/));
  it('rejects invalid decimal', () => expect(()=>normalizeImportRow({Qty:'x',Type:'buy'}, {Qty:'quantity',Type:'transaction_type'})).toThrow());
  it('rejects invalid money', () => expect(()=>normalizeImportRow({Amt:'12.3',Type:'buy'}, {Amt:'gross_amount',Type:'transaction_type'})).toThrow(/gross_amount/));
  it('creates deterministic fingerprints', async () => { const n={transaction_type:'buy',trade_date:'2026-01-01',quantity:'1',unit_price:'2',gross_amount:2,charges:0,taxes:0,net_amount:2}; const a={id:1}; const s={id:2}; await expect(fingerprint(1,n,a,s)).resolves.toBe(await fingerprint(1,n,a,s)); });
});

describe('wealth asset resolver order', () => {
  function ctx(rows:any[]) { return { env:{ DB:{ prepare:(query:string)=>({ bind:(...binds:any[])=>({ all:async()=>({results:rows.filter(r => query.includes(r.match)).map(r=>r.row)}), first:async()=>null, run:async()=>({success:true,meta:{}}) }) }) } } } as any; }
  it('resolves by ISIN before other identifiers', async () => {
    const asset={id:1,name:'By ISIN',asset_type:'stock'};
    await expect(resolveAsset(ctx([{match:'isin=?',row:asset}]),1,{isin:'INE002A01018',symbol:'OTHER',exchange:'NSE',asset_type:'stock',asset_name:'Other',currency:'INR'})).resolves.toMatchObject({id:1,name:'By ISIN'});
  });
  it('resolves by symbol/exchange/type', async () => {
    const asset={id:2,name:'By Symbol',asset_type:'stock'};
    await expect(resolveAsset(ctx([{match:'symbol=? AND exchange=? AND asset_type=?',row:asset}]),1,{symbol:'RELIANCE',exchange:'NSE',asset_type:'stock',asset_name:'Reliance',currency:'INR'})).resolves.toMatchObject({id:2,name:'By Symbol'});
  });
  it('resolves by exact name/type and creates candidates when unresolved', async () => {
    const asset={id:3,name:'Exact Name',asset_type:'stock'};
    await expect(resolveAsset(ctx([{match:'lower(name)=lower(?)',row:asset}]),1,{asset_name:'Exact Name',asset_type:'stock',currency:'INR'})).resolves.toMatchObject({id:3,name:'Exact Name'});
    await expect(resolveAsset(ctx([]),1,{asset_name:'NewCo',symbol:'NEWCO',exchange:'NSE',asset_type:'stock',currency:'INR'})).resolves.toMatchObject({candidate:{name:'NewCo',symbol:'NEWCO',exchange:'NSE',asset_type:'stock'}});
  });
});

describe('wealth account resolver explicit account_id', () => {
  it('accepts explicit valid account_id without account_name', async () => {
    const ctx = { env: { DB: { prepare: () => ({ bind: (...binds:any[]) => ({ first: async () => binds[0] === 9 ? { id: 9, name: 'Zerodha', account_type: 'brokerage' } : null, all: async () => ({ results: [] }), run: async () => ({ success: true, meta: {} }) }) }) } } } as any;
    await expect(resolveAccount(ctx, 1, { account_id: 9 }, {})).resolves.toMatchObject({ id: 9, name: 'Zerodha' });
  });
});

describe('wealth asset ambiguity diagnostics', () => {
  it('reports duplicate active ISIN metadata and makes resolver fail clearly', async () => {
    const rows = [
      { id: 10, name: 'TCS', symbol: 'TCS', isin: 'INE467B01029', has_transactions: 1, has_prices: 0, has_open_holdings: 1 },
      { id: 11, name: 'TCS duplicate', symbol: 'TCS', isin: 'INE467B01029', has_transactions: 0, has_prices: 0, has_open_holdings: 0 },
    ];
    const ctx = { env: { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }), first: async () => null, run: async () => ({ success: true, meta: {} }) }) }) } } } as any;
    await expect(resolveAsset(ctx, 1, { isin: 'INE467B01029', asset_name: 'TCS', asset_type: 'stock', currency: 'INR' })).rejects.toThrow(/Ambiguous active assets for ISIN INE467B01029/);
  });
});
