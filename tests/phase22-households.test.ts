import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import households from '../src/server/routes/households';
import members from '../src/server/routes/household-members';
import ownership from '../src/server/routes/ownership';
import allocations from '../src/server/routes/movement-allocations';
import { allocateValue, resolveOwnership } from '../src/server/ownership-service';

function mockDB(rowsByQuery: { match: string; rows?: any[]; first?: any }[] = []) {
  const prepare = vi.fn((query: string) => {
    const hit = rowsByQuery.find((r) => query.includes(r.match));
    const rows = hit?.rows ?? [];
    const first = hit?.first;
    return { bind: vi.fn((..._args: any[]) => ({ all: vi.fn(async () => ({ results: rows })), first: vi.fn(async () => first ?? null), run: vi.fn(async () => ({ success: true, meta: { last_row_id: 7 } })) })) };
  });
  return { prepare } as unknown as D1Database;
}
function harness(db: D1Database) { const app = new Hono<{ Variables: { userId: number } }>(); app.use('*', async (c, next) => { c.set('userId', 1); await next(); }); app.route('/api', households); app.route('/api', members); app.route('/api', ownership); app.route('/api', allocations); return { app, env: { DB: db } as any }; }

describe('Phase 22 household support', () => {
  it('creates default household and self member when listing households', async () => {
    const db = mockDB([{ match: 'SELECT * FROM households WHERE user_id=? AND active=1', first: null }, { match: "SELECT * FROM households WHERE user_id=? AND id=?", first: { id: 7, name: 'My Household' } }, { match: "SELECT * FROM household_members WHERE user_id=? AND household_id=? AND relationship='self'", first: null }, { match: 'SELECT * FROM household_members WHERE user_id=? AND id=?', first: { id: 8, relationship: 'self' } }, { match: 'SELECT * FROM households WHERE user_id=? ORDER BY', rows: [{ id: 7 }] }]);
    const { app, env } = harness(db); const res = await app.request('/api/households', {}, env);
    expect(res.status).toBe(200); expect((db as any).prepare.mock.calls.map((c:any)=>c[0]).join('\n')).toMatch(/INSERT INTO households/);
  });
  it('rejects future member birth dates and enforces one-self-member rule', async () => {
    const db = mockDB([{ match: "SELECT id FROM household_members", first: { id: 1 } }]); const { app, env } = harness(db);
    expect((await app.request('/api/households/1/members', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name:'Kid', relationship:'child', date_of_birth:'2999-01-01' }) }, env)).status).toBe(400);
    expect((await app.request('/api/households/1/members', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ display_name:'Me', relationship:'self' }) }, env)).status).toBe(409);
  });
  it('resolves old records to Self 100% and splits equal joint ownership without duplicating totals', async () => {
    const db = mockDB([{ match:'SELECT * FROM households WHERE user_id=? AND active=1', first:{ id:1 } }, { match:"SELECT * FROM household_members WHERE user_id=? AND household_id=? AND relationship='self'", first:{ id:2, display_name:'Self', relationship:'self' } }, { match:'FROM financial_record_ownership o', rows:[] }]);
    const resolved = await resolveOwnership(db, 1, 'wallet', 99);
    expect(resolved.total_allocated_percent).toBe(100); expect(resolved.warnings.join(' ')).toMatch(/Self 100% fallback/);
    const split = allocateValue(1000, { allocations: [{ member_id: 1, ownership_type: 'joint', allocation_basis: 'percentage', ownership_percent: 50 }, { member_id: 2, ownership_type: 'joint', allocation_basis: 'percentage', ownership_percent: 50 }] });
    expect(split.member_total).toBe(1000);
  });
  it('rejects ownership above 100%', async () => {
    const db = mockDB([{ match:'SELECT * FROM households WHERE user_id=? AND active=1', first:{ id:1 } }, { match:"SELECT * FROM household_members WHERE user_id=? AND household_id=? AND relationship='self'", first:{ id:2 } }, { match:'SELECT ownership_percent FROM financial_record_ownership', rows:[{ ownership_percent: 60 }] }]); const { app, env } = harness(db);
    const res = await app.request('/api/ownership', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ record_type:'wallet', record_id:1, member_id:2, ownership_type:'individual', ownership_percent:50, allocation_basis:'percentage' }) }, env);
    expect(res.status).toBe(400); expect(await res.json()).toMatchObject({ error: expect.stringMatching(/exceed/) });
  });
  it('requires shared expense allocations to equal the movement amount', async () => {
    const db = mockDB([{ match:'SELECT * FROM movements', first:{ id:5, amount:1000 } }, { match:'SELECT * FROM households WHERE user_id=? AND active=1', first:{ id:1 } }, { match:"SELECT * FROM household_members WHERE user_id=? AND household_id=? AND relationship='self'", first:{ id:2 } }]); const { app, env } = harness(db);
    const res = await app.request('/api/movements/5/allocations', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ items:[{ allocation_type:'fixed_amount', member_id:2, allocation_amount:400 }] }) }, env);
    expect(res.status).toBe(400); expect(await res.json()).toMatchObject({ error: expect.stringMatching(/must equal/) });
  });
});
