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
  it('rejects duplicate file preview', async () => { const h=harness(mockDB([{match:'SELECT id,status FROM wealth_import_batches', first:{id:1,status:'imported'}}])); const fd=new FormData(); fd.append('file', new File(['account_name\nA\n'], 'a.csv', {type:'text/csv'})); fd.append('mapping', '{}'); const res=await h.app.request('/api/wealth/imports/preview', {method:'POST', body:fd}, h.env); expect(res.status).toBe(409); });
});
