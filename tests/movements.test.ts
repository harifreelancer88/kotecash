import { describe, it, expect, vi, beforeEach } from 'vitest';
import movementsApp from '../src/server/routes/movements';

// Minimal mock D1. `rowsByQuery` lets a test seed results keyed by a substring of the SQL.
function mockDB(rowsByQuery: { match: string; rows: any[]; first?: any }[] = []) {
  const prepare = vi.fn((query: string) => {
    const hit = rowsByQuery.find((r) => query.includes(r.match));
    const rows = hit?.rows ?? [];
    const first = hit?.first;
    return {
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: rows })),
        first: vi.fn(async () => first ?? null),
        run: vi.fn(async () => ({ success: true, meta: { last_row_id: 1 } })),
      })),
      all: vi.fn(async () => ({ results: rows })),
      first: vi.fn(async () => first ?? null),
      run: vi.fn(async () => ({ success: true, meta: { last_row_id: 1 } })),
    };
  });
  return { prepare, batch: vi.fn(async (stmts: any[]) => stmts.map(() => ({ success: true }))) } as unknown as D1Database;
}

// Auth middleware in tests is bypassed by injecting userId via Hono context default.
// The route uses c.get('userId'); we set it by mounting under a tiny wrapper.
import { Hono } from 'hono';
function harness(db: D1Database) {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  app.route('/api/movements', movementsApp);
  return { app, env: { DB: db } as any };
}

async function req(app: any, env: any, path: string, init: any = {}) {
  return app.request(`/api/movements${path}`, { ...init }, env);
}

describe('movements route', () => {
  it('GET filters by wallet_id (matches src or dst)', async () => {
    const db = mockDB([{ match: 'FROM movements', rows: [{ id: 1, amount: 100 }] }]);
    const { app, env } = harness(db);
    const res = await req(app, env, '?wallet_id=6');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 1, amount: 100 }]);
    const sql = (db as any).prepare.mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/src_id.*6|src_kind.*wallet/);
  });

  it('POST creates a movement with src/dst', async () => {
    const db = mockDB();
    const { app, env } = harness(db);
    const res = await req(app, env, '', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 500, date: '2026-06-22', src_kind: 'wallet', src_id: 6, dst_kind: null, category_id: 3, description: 'Pasar' }),
    });
    expect(res.status).toBe(201);
    const sql = (db as any).prepare.mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/INSERT INTO movements/);
  });

  it('POST rejects non-positive amount', async () => {
    const { app, env } = harness(mockDB());
    const res = await req(app, env, '', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0, date: '2026-06-22', src_kind: 'wallet', src_id: 6, dst_kind: null }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT updates amount and keeps ownership', async () => {
    const db = mockDB();
    const { app, env } = harness(db);
    const res = await req(app, env, '/5', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 999, date: '2026-06-22', src_kind: 'wallet', src_id: 6, dst_kind: null, category_id: 3 }),
    });
    expect(res.status).toBe(200);
    const sql = (db as any).prepare.mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/UPDATE movements SET/);
    expect(sql).toMatch(/user_id=\?/);
  });

  it('POST /batch inserts N rows', async () => {
    const db = mockDB();
    const { app, env } = harness(db);
    const res = await req(app, env, '/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [
        { amount: 50, date: '2026-06-22', src_kind: 'wallet', src_id: 6, dst_kind: null, category_id: 3 },
        { amount: 60, date: '2026-06-22', src_kind: 'wallet', src_id: 6, dst_kind: null, category_id: 3 },
      ]}),
    });
    expect(res.status).toBe(201);
    const inserts = (db as any).prepare.mock.calls.filter((c: any) => c[0].includes('INSERT INTO movements')).length;
    expect(inserts).toBe(2);
  });
});
