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
