import { describe, it, expect, vi } from 'vitest';
import movementsApp from '../src/server/routes/movements';
import { Hono } from 'hono';

function mockDB(opts: { failRun?: boolean; failBatch?: boolean; missingMovement?: boolean; missingCategory?: boolean; missingWallet?: boolean; existingRule?: boolean } = {}) {
  const prepare = vi.fn((query: string) => ({
    bind: vi.fn((...binds: any[]) => ({
      all: vi.fn(async () => ({ results: query.includes('FROM movements') ? [{ id: 1, amount: 100 }] : [] })),
      first: vi.fn(async () => {
        if (query.includes('FROM merchant_categorization_rules')) return opts.existingRule ? { id: 44 } : null;
        if (query.includes('FROM movements')) return opts.missingMovement ? null : { id: binds[0] };
        if (query.includes('FROM categories')) return opts.missingCategory ? null : { id: binds[1], type: 'expense' };
        if (query.includes('FROM wallets')) return opts.missingWallet ? null : { id: binds[1] };
        return null;
      }),
      run: vi.fn(async () => { if (opts.failRun) throw new Error('D1_ERROR: bad SQL'); return { success: true, meta: { last_row_id: 1 } }; }),
    })),
  }));
  return { prepare, batch: vi.fn(async (stmts: any[]) => { if (opts.failBatch || opts.failRun) throw new Error('D1_ERROR: batch failed'); return stmts.map((_: any, i: number) => ({ success: true, meta: { last_row_id: i + 1, changes: i === stmts.length - 1 ? 6 : 1 } })); }) } as unknown as D1Database;
}

function harness(db: D1Database) {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use('*', async (c, next) => { c.set('userId', 1); await next(); });
  app.route('/api/movements', movementsApp);
  return { app, env: { DB: db } as any };
}
async function req(app: any, env: any, path: string, init: any = {}) { return app.request(`/api/movements${path}`, { ...init }, env); }
const body = { amount: 999, date: '2026-06-22', src_kind: 'wallet', src_id: 6, dst_kind: null, dst_id: null, category_id: 3, description: 'Edited' };

describe('movements route', () => {
  it('GET filters by wallet_id (matches src or dst)', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    const res = await req(app, env, '?wallet_id=6');
    expect(res.status).toBe(200); expect(await res.json()).toEqual([{ id: 1, amount: 100 }]);
  });
  it('PUT edits movement fields without inserting or touching sync/status metadata', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    const res = await req(app, env, '/5', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ success: true, id: 5, transaction_saved: true, existing_updated: 0 });
    const sql = (db as any).prepare.mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/UPDATE movements SET date=\?, amount=\?, description=\?, category_id=\?, src_kind=\?, src_id=\?, dst_kind=\?, dst_id=\?, updated_at=datetime\('now'\)/);
    expect(sql).not.toMatch(/INSERT INTO movements/);
    expect(sql).not.toMatch(/raw_sms_hash|transaction_time|status=|duplicate_of_movement_id|created_at|pennywise_sync_records/);
  });
  it('PUT supports amount, date, type, category, payment method, and notes changes', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    const income = { amount: 1200, date: '2026-07-01', src_kind: null, src_id: null, dst_kind: 'wallet', dst_id: 9, category_id: 4, description: 'Salary note' };
    const res = await req(app, env, '/7', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(income) });
    expect(res.status).toBe(200);
    const binds = (db as any).prepare.mock.results.at(-1).value.bind.mock.calls[0];
    expect(binds.slice(0, 8)).toEqual(['2026-07-01', 1200, 'Salary note', 4, null, null, 'wallet', 9]);
  });
  it('POST creates a movement; PUT does not create duplicates', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    const res = await req(app, env, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const inserts = (db as any).prepare.mock.calls.filter((c: any) => c[0].includes('INSERT INTO movements')).length;
    expect(inserts).toBe(1);
  });

  it('POST supports independent merchant rule and bulk update flags', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    const res = await req(app, env, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, description: 'P Murugeshan | UPI', apply_merchant_rule: true, update_existing_merchant: true }) });
    expect(res.status).toBe(201);
    const json: any = await res.json();
    expect(json).toMatchObject({ transaction_saved: true, existing_updated: 6 });
    const sql = (db as any).prepare.mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/INSERT INTO merchant_categorization_rules|UPDATE merchant_categorization_rules/);
    expect(sql).toMatch(/UPDATE movements SET category_id=\?/);
  });


  it('uses one DB.batch for both checkbox writes so movement, rule, and history are atomic', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    const res = await req(app, env, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, description: 'P Murugeshan | UPI', apply_merchant_rule: true, update_existing_merchant: true }) });
    expect(res.status).toBe(201);
    expect((db as any).batch).toHaveBeenCalledTimes(1);
    expect((db as any).batch.mock.calls[0][0]).toHaveLength(3);
  });

  it('returns JSON error and no success body when an atomic write batch fails', async () => {
    const db = mockDB({ failBatch: true }); const { app, env } = harness(db);
    const res = await req(app, env, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, description: 'P Murugeshan | UPI', apply_merchant_rule: true, update_existing_merchant: true }) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Unable to create movement' });
    expect((db as any).batch).toHaveBeenCalledTimes(1);
  });

  it('keeps rule-only and bulk-only operations inside atomic batches', async () => {
    for (const flags of [{ apply_merchant_rule: true }, { update_existing_merchant: true }]) {
      const db = mockDB(); const { app, env } = harness(db);
      const res = await req(app, env, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, description: 'P Murugeshan | UPI', ...flags }) });
      expect(res.status).toBe(201);
      expect((db as any).batch.mock.calls[0][0]).toHaveLength(2);
    }
  });

  it('uses ON CONFLICT for same-key concurrent rule creation instead of duplicate-prone insert-only logic', async () => {
    const db = mockDB(); const { app, env } = harness(db);
    await req(app, env, '', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, description: 'P Murugeshan | UPI', apply_merchant_rule: true }) });
    const sql = (db as any).prepare.mock.calls.map((c: any) => c[0]).join('\n');
    expect(sql).toMatch(/ON CONFLICT\(user_id, normalized_merchant_name, movement_type, active\) DO UPDATE/);
  });

  it('rejects invalid movement ID with valid JSON', async () => {
    const { app, env } = harness(mockDB()); const res = await req(app, env, '/abc', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'Invalid movement ID' });
  });
  it('rejects invalid category/payment method with valid JSON', async () => {
    let h = harness(mockDB({ missingCategory: true })); let res = await req(h.app, h.env, '/5', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'Category not found' });
    h = harness(mockDB({ missingWallet: true })); res = await req(h.app, h.env, '/5', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'Wallet not found' });
  });
  it('returns valid JSON for validation and database failures', async () => {
    let h = harness(mockDB()); let res = await req(h.app, h.env, '/5', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, amount: 0 }) });
    expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: 'Amount must be positive' });
    h = harness(mockDB({ failRun: true })); res = await req(h.app, h.env, '/5', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(500); expect(await res.json()).toEqual({ error: 'Unable to update movement' });
  });
});
