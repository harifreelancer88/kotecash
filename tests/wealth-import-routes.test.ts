import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import wealthImports from '../src/server/routes/wealth-imports';

function mockDB(rowsByQuery: { match: string; rows?: any[]; first?: any; run?: any }[] = []) {
  const prepare = vi.fn((query: string) => {
    const hit = rowsByQuery.find((r) => query.includes(r.match));
    const rows = hit?.rows ?? [];
    const first = hit?.first ?? null;
    const run = hit?.run ?? { success: true, meta: { last_row_id: 7, changes: 1 } };
    return { bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: rows })), first: vi.fn(async () => first), run: vi.fn(async () => run) })) };
  });
  return { prepare } as unknown as D1Database;
}
function harness(db: D1Database, authed = true) { const app = new Hono<{ Variables: { userId: number } }>(); if (authed) app.use('*', async (c, next) => { c.set('userId', 1); await next(); }); app.route('/api/wealth/imports', wealthImports); return { app, env: { DB: db } as any }; }

describe('wealth import routes', () => {
  it('returns the CSV template with download headers', async () => { const h=harness(mockDB()); const res=await h.app.request('/api/wealth/imports/template', {}, h.env); expect(res.status).toBe(200); expect(res.headers.get('content-type')).toContain('text/csv'); expect(res.headers.get('content-disposition')).toContain('kotecash-wealth-import-template.csv'); expect(await res.text()).toContain('account_name,account_type'); });
  it('lists batches for the current user', async () => { const h=harness(mockDB([{match:'FROM wealth_import_batches WHERE', rows:[{id:1,file_name:'a.csv',status:'validated'}]}])); const res=await h.app.request('/api/wealth/imports', {}, h.env); expect(res.status).toBe(200); expect(await res.json()).toEqual([{id:1,file_name:'a.csv',status:'validated'}]); });
  it('fetches batch details with paginated row metadata', async () => { const h=harness(mockDB([
    {match:'SELECT * FROM wealth_import_batches', first:{id:7,user_id:1,file_name:'holdings.csv',file_hash:'abcdef1234567890',status:'previewed',mapping_json:'{}',options_json:'{}',total_rows:30}},
    {match:'SELECT row_number,status,normalized_json', rows:[{row_number:1,status:'valid',normalized_json:JSON.stringify({transaction_type:'transfer_in',trade_date:'2026-03-31',quantity:'17'}),warning_json:'[]'}]},
    {match:'SELECT COUNT(*) count FROM wealth_import_rows', first:{count:30}},
  ])); const res=await h.app.request('/api/wealth/imports/7?page=2&page_size=10', {}, h.env); expect(res.status).toBe(200); const json:any=await res.json(); expect(json.batch.id).toBe(7); expect(json.row_total).toBe(30); expect(json.page_size).toBe(10); expect(json.rows[0].normalized.transaction_type).toBe('transfer_in'); });
  it('blocks zero-cost transfer_in commits without explicit override', async () => { const h=harness(mockDB([
    {match:'SELECT * FROM wealth_import_batches', first:{id:7,status:'validated',valid_rows:1,invalid_rows:0}},
    {match:'SELECT * FROM wealth_import_rows', rows:[{id:1,status:'valid',normalized_json:JSON.stringify({transaction_type:'transfer_in',unit_price:'0',gross_amount:'0',net_amount:'0'})}]},
  ])); const res=await h.app.request('/api/wealth/imports/7/commit', {method:'POST', body:JSON.stringify({}), headers:{'content-type':'application/json'}}, h.env); expect(res.status).toBe(400); expect((await res.json() as any).error).toContain('explicit override'); });
  it('rejects duplicate file preview', async () => { const h=harness(mockDB([{match:'SELECT id,status FROM wealth_import_batches', first:{id:1,status:'imported'}}])); const fd=new FormData(); fd.append('file', new File(['account_name\nA\n'], 'a.csv', {type:'text/csv'})); fd.append('mapping', '{}'); const res=await h.app.request('/api/wealth/imports/preview', {method:'POST', body:fd}, h.env); expect(res.status).toBe(409); });
  it('deletes a previewed uncommitted batch without touching finance records or movements', async () => {
    const db=mockDB([
      {match:'SELECT * FROM wealth_import_batches', first:{id:10,user_id:1,status:'previewed',imported_rows:0}},
      {match:'created_transaction_id IS NOT NULL', first:{count:0}},
      {match:'FROM investment_transactions WHERE user_id=? AND import_batch_id=?', first:{count:0}},
      {match:'FROM investment_prices WHERE user_id=? AND import_batch_id=?', first:{count:0}},
      {match:'SELECT COUNT(*) count FROM wealth_import_rows WHERE user_id=? AND batch_id=?', first:{count:56}},
      {match:'DELETE FROM wealth_import_rows', run:{success:true,meta:{changes:56}}},
      {match:'DELETE FROM wealth_import_batches', run:{success:true,meta:{changes:1}}},
    ]);
    const h=harness(db);
    const res=await h.app.request('/api/wealth/imports/10',{method:'DELETE'},h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({deleted:true,deleted_rows:56});
    const sql=(db.prepare as any).mock.calls.map((c:any)=>c[0]).join('\n');
    expect(sql).toMatch(/DELETE FROM wealth_import_rows/);
    expect(sql).toMatch(/DELETE FROM wealth_import_batches/);
    expect(sql).not.toMatch(/DELETE FROM investment_transactions|DELETE FROM investment_prices|DELETE FROM movements/i);
  });
  it.each(['imported','partially_imported','rolled_back'])('rejects deleting %s batches', async (status) => {
    const h=harness(mockDB([{match:'SELECT * FROM wealth_import_batches', first:{id:10,user_id:1,status,imported_rows:status==='imported'?56:13}}]));
    const res=await h.app.request('/api/wealth/imports/10',{method:'DELETE'},h.env);
    expect(res.status).toBe(400);
  });
  it('rejects deleting uncommitted batches with created financial records', async () => {
    const h=harness(mockDB([
      {match:'SELECT * FROM wealth_import_batches', first:{id:10,user_id:1,status:'previewed',imported_rows:0}},
      {match:'created_transaction_id IS NOT NULL', first:{count:1}},
    ]));
    const res=await h.app.request('/api/wealth/imports/10',{method:'DELETE'},h.env);
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain('created financial records');
  });
  it('returns not found when another user deletes the batch', async () => {
    const h=harness(mockDB([{match:'SELECT * FROM wealth_import_batches', first:null}]));
    const res=await h.app.request('/api/wealth/imports/10',{method:'DELETE'},h.env);
    expect(res.status).toBe(404);
  });
});

describe('wealth import commit eligibility regression', () => {
  it('reports 0 valid / 17 invalid batches as not commit eligible', async () => { const h=harness(mockDB([
    {match:'SELECT * FROM wealth_import_batches', first:{id:5,user_id:1,file_name:'ai.pdf',file_hash:'abcdef1234567890',status:'previewed',valid_rows:0,invalid_rows:17,total_rows:17,mapping_json:'{}',options_json:'{}'}},
    {match:'SELECT row_number,status,normalized_json', rows:[{row_number:1,status:'invalid',normalized_json:null,error_message:'Missing account identifier',warning_json:'[]'}]},
    {match:'SELECT COUNT(*) count FROM wealth_import_rows', first:{count:17}},
  ])); const res=await h.app.request('/api/wealth/imports/5', {}, h.env); expect(res.status).toBe(200); expect((await res.json() as any).can_commit).toBe(false); });
  it('backend commit rejects invalid batches and creates no transactions', async () => { const db=mockDB([
    {match:'SELECT * FROM wealth_import_batches', first:{id:5,status:'previewed',valid_rows:0,invalid_rows:17}},
    {match:'SELECT * FROM wealth_import_rows', rows:[]},
  ]); const h=harness(db); const res=await h.app.request('/api/wealth/imports/5/commit',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},h.env); expect(res.status).toBe(400); expect((await res.json() as any).error).toContain('no valid rows'); expect((db.prepare as any).mock.calls.map((c:any)=>c[0]).join('\n')).not.toMatch(/INSERT INTO investment_transactions/i); });
  it('requires create_missing_assets for candidate asset commits', async () => { const h=harness(mockDB([
    {match:'SELECT * FROM wealth_import_batches', first:{id:8,status:'validated',valid_rows:1,invalid_rows:0}},
    {match:'SELECT * FROM wealth_import_rows', rows:[{id:1,status:'valid',normalized_json:JSON.stringify({transaction_type:'transfer_in',unit_price:'10',gross_amount:10,net_amount:10,account:{id:9},asset:{candidate:{name:'NewCo',asset_type:'stock',symbol:'NEWCO'}}})}]},
  ])); const res=await h.app.request('/api/wealth/imports/8/commit',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},h.env); expect(res.status).toBe(400); expect((await res.json() as any).error).toContain('Missing asset creation not allowed'); });
});

describe('wealth import same-batch sequencing regression', () => {
  const tcsBuy = (row_number=1, date='2026-04-01', qty='57') => ({ id:row_number, row_number, status:'valid', normalized_json:JSON.stringify({transaction_type:'buy',trade_date:date,quantity:qty,gross_amount:5700,net_amount:5700,movement_id:null,account:{id:9},asset:{candidate:{name:'TCS',asset_type:'stock',symbol:'TCS',isin:'INE467B01029',exchange:'NSE',currency:'INR'}}}) });
  const tcsSell = (row_number=2, date='2026-05-04', qty='57', status='valid') => ({ id:row_number, row_number, status, normalized_json:JSON.stringify({transaction_type:'sell',trade_date:date,quantity:qty,gross_amount:6000,net_amount:6000,movement_id:null,account:{id:9},asset:{candidate:{name:'TCS',asset_type:'stock',symbol:'TCS',isin:'INE467B01029',exchange:'NSE',currency:'INR'}}}) });
  function commitHarness(rows:any[], failedRows:any[] = [], existingTx:any[] = []) {
    const prepare = vi.fn((query: string) => ({ bind: vi.fn(() => ({
      all: vi.fn(async () => {
        if (query.includes("status='failed'")) return { results: failedRows };
        if (query.includes('FROM wealth_import_rows')) return { results: rows };
        if (query.includes('FROM investment_transactions')) return { results: existingTx };
        return { results: [] };
      }),
      first: vi.fn(async () => query.includes('SELECT * FROM wealth_import_batches') ? {id:7,status:'validated',valid_rows:rows.length,invalid_rows:0} : null),
      run: vi.fn(async () => ({ success: true, meta: { last_row_id: 100, changes: 1 } })),
    })) }));
    return { ...harness({ prepare } as unknown as D1Database), prepare };
  }
  it('imports buy then later sell for a new TCS asset in one batch without oversell or movements', async () => {
    const h=commitHarness([tcsBuy(), tcsSell()]);
    const res=await h.app.request('/api/wealth/imports/7/commit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({create_missing_assets:true})},h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({imported_rows:2,failed_rows:0});
    const sql=h.prepare.mock.calls.map((c:any)=>c[0]).join('\n');
    expect((sql.match(/INSERT INTO investment_assets/g)||[])).toHaveLength(1);
    expect((sql.match(/INSERT INTO investment_transactions/g)||[])).toHaveLength(2);
    expect(sql).toMatch(/status=\?,committed_at=.*WHERE id=\?/);
    expect(sql).not.toMatch(/INSERT INTO movements/);
  });
  it('rejects sell before buy in the same batch', async () => {
    const h=commitHarness([tcsSell(1,'2026-04-01'), tcsBuy(2,'2026-05-04')], [{id:1},{id:2}]);
    const res=await h.app.request('/api/wealth/imports/7/commit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({create_missing_assets:true})},h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({failed_rows:2});
    expect(h.prepare.mock.calls.map((c:any)=>c[0]).join('\n')).not.toMatch(/INSERT INTO investment_transactions/);
  });
  it('rejects sells greater than same-batch buys', async () => {
    const h=commitHarness([tcsBuy(1,'2026-04-01','10'), tcsSell(2,'2026-05-04','11')], [{id:1},{id:2}]);
    const res=await h.app.request('/api/wealth/imports/7/commit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({create_missing_assets:true})},h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({failed_rows:2});
  });
  it('allows multiple buys followed by a sell and uses row order for same-date sequencing', async () => {
    const h=commitHarness([tcsBuy(1,'2026-04-01','20'), tcsBuy(2,'2026-04-01','37'), tcsSell(3,'2026-04-01','57')]);
    const res=await h.app.request('/api/wealth/imports/7/commit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({create_missing_assets:true})},h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({imported_rows:3,failed_rows:0});
  });
  it('retry skips imported rows and imports only the previously failed TCS sell once', async () => {
    const h=commitHarness([{...tcsBuy(),status:'imported',created_transaction_id:55,created_asset_id:100}, tcsSell(2,'2026-05-04','57','failed')], [], [{id:55,account_id:9,asset_id:100,transaction_type:'buy',trade_date:'2026-04-01',quantity:'57',gross_amount:5700,net_amount:5700}]);
    const res=await h.app.request('/api/wealth/imports/7/commit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({create_missing_assets:true})},h.env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({imported_rows:1,skipped_rows:1,failed_rows:0});
    const sql=h.prepare.mock.calls.map((c:any)=>c[0]).join('\n');
    expect((sql.match(/INSERT INTO investment_transactions/g)||[])).toHaveLength(1);
  });
});

describe('wealth import duplicate/rollback metadata regressions', () => {
  it('duplicate detection SQL ignores preview/rolled-back/failed history and requires surviving records', async () => {
    const db = mockDB();
    const h = harness(db);
    const fd = new FormData();
    fd.append('file', new File(['account_name,account_type,asset_name,asset_type,symbol,isin,transaction_type,trade_date,quantity,currency\nZerodha,brokerage,Chola,stock,CHOLAHLDNG,INE149A01033,buy,2026-04-01,1,INR\n'], 'one.csv', { type: 'text/csv' }));
    fd.append('mapping', '{}');
    fd.append('options', '{}');
    await h.app.request('/api/wealth/imports/preview', { method: 'POST', body: fd }, h.env);
    const sql = (db.prepare as any).mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/JOIN wealth_import_batches/);
    expect(sql).toMatch(/NOT IN \('rolled_back','uploaded','previewed','validated','failed'\)/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM investment_transactions/);
  });

  it('rollback clears created IDs and remains idempotent for already rolled back batches', async () => {
    let db = mockDB([
      { match: 'SELECT * FROM wealth_import_batches', first: { id: 9, status: 'imported' } },
      { match: 'SELECT COUNT(*) count FROM investment_transactions t', first: { count: 0 } },
    ]);
    let h = harness(db);
    let res = await h.app.request('/api/wealth/imports/9/rollback', { method: 'POST' }, h.env);
    expect(res.status).toBe(200);
    let sql = (db.prepare as any).mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/created_transaction_id=NULL, created_price_id=NULL/);
    db = mockDB([{ match: 'SELECT * FROM wealth_import_batches', first: { id: 9, status: 'rolled_back' } }]);
    h = harness(db);
    res = await h.app.request('/api/wealth/imports/9/rollback', { method: 'POST' }, h.env);
    expect(await res.json()).toMatchObject({ deleted_transactions: 0, deleted_prices: 0 });
  });
});
