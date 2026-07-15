import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import pennywise from "../src/server/routes/pennywise";

function db(opts: { wallet?: boolean; category?: boolean; existing?: any; existingByClient?: any; existingBySms?: any; possible?: any } = {}) {
  const prepare = vi.fn((query: string) => ({
    bind: vi.fn((...args: any[]) => ({
      first: vi.fn(async () => {
        if (query.includes("FROM wallets")) return opts.wallet === false ? null : { id: args[0] };
        if (query.includes("FROM categories")) return opts.category === false ? null : { id: args[0] };
        if (query.includes("client_transaction_id") && query.includes("SELECT *")) return opts.existingByClient ?? opts.existing ?? null;
        if (query.includes("sms_fingerprint") && query.includes("SELECT *")) return opts.existingBySms ?? opts.existing ?? null;
        if (query.includes("financial_fingerprint")) return opts.possible ?? null;
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true, meta: { last_row_id: 77 } })),
    })),
  }));
  return { prepare } as unknown as D1Database;
}
function appWith(db: D1Database) {
  const app = new Hono<{ Variables: { userId: number } }>();
  app.use("*", async (c, next) => { c.set("userId", 1); await next(); });
  app.route("/api/integrations/pennywise", pennywise);
  return { app, env: { DB: db } as any };
}
const tx = { client_transaction_id: "local-1", sms_fingerprint: "sms-1", transaction_date: "2026-07-15", amount: 1250, direction: "expense", wallet_id: 4, category_id: 9, merchant: "Swiggy", description: "UPI payment", source: "sms" };
async function post(app: any, env: any, path: string, body: any) {
  return app.request(`/api/integrations/pennywise${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
}

describe("PennyWise integration routes", () => {
  it("previews without creating movements", async () => {
    const mock = db(); const { app, env } = appWith(mock);
    const res = await post(app, env, "/preview", { client_id: "phone", transactions: [tx] });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.results[0].supported).toBe(true);
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).not.toMatch(/INSERT INTO movements/);
  });

  it("creates an expense movement and sync record", async () => {
    const mock = db(); const { app, env } = appWith(mock);
    const res = await post(app, env, "/movements", { client_id: "phone", transactions: [tx] });
    expect(res.status).toBe(207);
    const body = await res.json<any>();
    expect(body.results[0]).toMatchObject({ status: "created", movement_id: 77 });
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).toMatch(/INSERT INTO movements/);
    expect(sql).toMatch(/INSERT INTO pennywise_sync_records/);
  });

  it("returns already_synced for duplicate client transaction ids", async () => {
    const { app, env } = appWith(db({ existing: { movement_id: 55, sync_status: "created" } }));
    const res = await post(app, env, "/movements", { client_id: "phone", transactions: [tx] });
    const body = await res.json<any>();
    expect(body.results[0]).toMatchObject({ status: "already_synced", movement_id: 55 });
  });

  it("treats raw_sms_hash as an SMS fingerprint for duplicate imports", async () => {
    const { app, env } = appWith(db({ existingByClient: null, existingBySms: { movement_id: 66, sync_status: "created" } }));
    const res = await post(app, env, "/movements", { client_id: "phone-2", transactions: [{ ...tx, client_transaction_id: "local-2", sms_fingerprint: undefined, raw_sms_hash: "raw-hash-1" }] });
    const body = await res.json<any>();
    expect(body.results[0]).toMatchObject({ status: "already_synced", movement_id: 66 });
  });

  it("does not create a movement when a prior commit is marked syncing", async () => {
    const mock = db({ existing: { sync_status: "syncing", movement_id: null } });
    const { app, env } = appWith(mock);
    const res = await post(app, env, "/movements", { client_id: "phone", transactions: [tx] });
    const body = await res.json<any>();
    expect(body.results[0].status).toBe("possible_duplicate");
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).not.toMatch(/INSERT INTO movements/);
  });

  it("flags same financial fingerprint as possible duplicate without deleting or merging", async () => {
    const mock = db({ possible: { id: 9, movement_id: 77 } });
    const { app, env } = appWith(mock);
    const res = await post(app, env, "/movements", { client_id: "phone", transactions: [{ ...tx, client_transaction_id: "local-unique", sms_fingerprint: "sms-unique" }] });
    const body = await res.json<any>();
    expect(body.results[0].status).toBe("possible_duplicate");
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).not.toMatch(/DELETE FROM movements|DELETE FROM pennywise_sync_records/);
  });

  it("allows same reference and amount when transaction time makes the financial event distinct", async () => {
    const mock = db();
    const { app, env } = appWith(mock);
    const res = await post(app, env, "/preview", { client_id: "phone", transactions: [
      { ...tx, client_transaction_id: "local-a", sms_fingerprint: "sms-a", transaction_time: "09:00:00", reference_number: "UPI123" },
      { ...tx, client_transaction_id: "local-b", sms_fingerprint: "sms-b", transaction_time: "18:00:00", reference_number: "UPI123" },
    ] });
    const body = await res.json<any>();
    expect(body.results.map((r: any) => r.duplicate_status)).toEqual(["none", "none"]);
  });

  it("blocks missing wallet mappings", async () => {
    const { app, env } = appWith(db({ wallet: false }));
    const res = await post(app, env, "/movements", { client_id: "phone", transactions: [tx] });
    const body = await res.json<any>();
    expect(body.results[0].status).toBe("mapping_missing");
  });

  it("rejects oversized batches and non-finite amounts", async () => {
    const { app, env } = appWith(db());
    const oversized = await post(app, env, "/preview", { client_id: "phone", transactions: Array.from({ length: 101 }, () => tx) });
    expect(oversized.status).toBe(400);
    const bad = await post(app, env, "/movements", { client_id: "phone", transactions: [{ ...tx, amount: Infinity }] });
    const body = await bad.json<any>();
    expect(body.results[0].status).toBe("validation_failed");
  });

  it("lists sync status records", async () => {
    const mock = db(); const { app, env } = appWith(mock);
    const res = await app.request("/api/integrations/pennywise/status?client_transaction_id=local-1", {}, env);
    expect(res.status).toBe(200);
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).toContain("client_transaction_id=?");
  });

  function duplicateDb(opts: { locked?: boolean; linked?: boolean; alreadyExcluded?: boolean } = {}) {
    const rows = [
      { movement_id: 10, transaction_date: "2026-07-15", transaction_time: null, amount: 18, description: "Bmtc | UPI:619636992949 | PennyWise", src_kind: "wallet", src_id: 1, dst_kind: null, dst_id: null, movement_status: "active", movement_created_at: "2026-07-15 10:00:00", duplicate_of_movement_id: null, wallet_name: "ICICI", sync_record_id: 100, client_id: "phone", client_transaction_id: "a", sms_fingerprint: null, raw_sms_hash: null, sync_status: "created", source: "sms", financial_fingerprint: "f1", reference_number: "619636992949", merchant: "Bmtc", sync_created_at: "2026-07-15 10:00:00", sync_updated_at: "2026-07-15 10:00:00" },
      { movement_id: 11, transaction_date: "2026-07-15", transaction_time: null, amount: 18, description: "Bmtc | UPI:619636992949 | PennyWise", src_kind: "wallet", src_id: 1, dst_kind: null, dst_id: null, movement_status: opts.alreadyExcluded ? "duplicate_excluded" : "active", movement_created_at: "2026-07-15 10:01:00", duplicate_of_movement_id: opts.alreadyExcluded ? 10 : null, wallet_name: "ICICI", sync_record_id: 101, client_id: "phone", client_transaction_id: "b", sms_fingerprint: null, raw_sms_hash: null, sync_status: "created", source: "sms", financial_fingerprint: "f2", reference_number: "619636992949", merchant: "Bmtc", sync_created_at: "2026-07-15 10:01:00", sync_updated_at: "2026-07-15 10:01:00" },
    ];
    const prepare = vi.fn((query: string) => ({
      bind: vi.fn((...args: any[]) => ({
        all: vi.fn(async () => {
          if (query.includes("JOIN pennywise_sync_records")) return { results: rows.filter(r => r.movement_status === "active") };
          if (query.includes("pennywise_duplicate_reviews") && query.includes("SELECT")) return { results: [] };
          if (query.includes("account_reconciliation_rows")) return { results: opts.locked ? [{ id: 1, status: "locked", locked: 1 }] : [] };
          if (query.includes("net_worth_snapshots")) return { results: [] };
          if (query.includes("liability_payments") || query.includes("goal_contributions") || query.includes("income_occurrence_allocations") || query.includes("investment_transactions") || query.includes("movement_allocations") || query.includes("financial_import_rows")) return { results: opts.linked ? [{ id: 99 }] : [] };
          return { results: [] };
        }),
        first: vi.fn(async () => {
          if (query.includes("SELECT * FROM movements")) return rows.find(r => r.movement_id === Number(args[1])) ? { id: Number(args[1]), user_id: 1, date: "2026-07-15", amount: 18, src_kind: "wallet", src_id: 1, dst_kind: null, dst_id: null, status: opts.alreadyExcluded && Number(args[1]) === 11 ? "duplicate_excluded" : "active", duplicate_of_movement_id: opts.alreadyExcluded && Number(args[1]) === 11 ? 10 : null } : null;
          if (query.includes("SELECT status,duplicate_of_movement_id")) return opts.alreadyExcluded ? { status: "duplicate_excluded", duplicate_of_movement_id: 10 } : { status: "active", duplicate_of_movement_id: null };
          return null;
        }),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1, last_row_id: 88 } })),
      })),
    }));
    return { prepare } as unknown as D1Database;
  }

  it("returns read-only duplicate candidates with movement and sync evidence", async () => {
    const mock = duplicateDb(); const { app, env } = appWith(mock);
    const res = await app.request("/api/integrations/pennywise/duplicate-candidates?date_from=2026-07-15&date_to=2026-07-15", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ confidence: "high", recommended_review_action: "mark_duplicate" });
    expect(body.candidates[0].involved_movements.map((m: any) => m.movement_id)).toEqual([10, 11]);
    expect(body.candidates[0].involved_sync_records.map((r: any) => r.sync_record_id)).toEqual([100, 101]);
  });

  it("soft-excludes a confirmed duplicate without hard deletion", async () => {
    const mock = duplicateDb(); const { app, env } = appWith(mock);
    const candidates = await (await app.request("/api/integrations/pennywise/duplicate-candidates", {}, env)).json<any>();
    const group = candidates.candidates[0].candidate_group_id;
    const res = await post(app, env, "/duplicate-candidates/review", { candidate_group_id: group, action: "mark_duplicate", retained_movement_id: 10, duplicate_movement_id: 11, confirm: true });
    expect(res.status).toBe(200);
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).toMatch(/UPDATE movements SET status='duplicate_excluded'/);
    expect(sql).not.toMatch(/DELETE FROM movements|DELETE FROM pennywise_sync_records/);
    expect(sql).toMatch(/pennywise_duplicate_audit_events/);
  });

  it("blocks duplicate resolution when a locked reconciliation depends on the movement", async () => {
    const mock = duplicateDb({ locked: true }); const { app, env } = appWith(mock);
    const candidates = await (await app.request("/api/integrations/pennywise/duplicate-candidates", {}, env)).json<any>();
    const res = await post(app, env, "/duplicate-candidates/review", { candidate_group_id: candidates.candidates[0].candidate_group_id, action: "mark_duplicate", retained_movement_id: 10, duplicate_movement_id: 11, confirm: true });
    expect(res.status).toBe(409);
    const body = await res.json<any>();
    expect(body.dependency_report.blocks[0].type).toBe("locked_reconciliation");
  });

  it("is idempotent when the duplicate was already excluded", async () => {
    const mock = duplicateDb({ alreadyExcluded: true }); const { app, env } = appWith(mock);
    const res = await post(app, env, "/duplicate-candidates/review", { candidate_group_id: "pwdup:any", action: "mark_duplicate", retained_movement_id: 10, duplicate_movement_id: 11, confirm: true });
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.idempotent).toBe(true);
  });

  it("records Keep all without excluding either movement", async () => {
    const mock = duplicateDb(); const { app, env } = appWith(mock);
    const candidates = await (await app.request("/api/integrations/pennywise/duplicate-candidates", {}, env)).json<any>();
    const res = await post(app, env, "/duplicate-candidates/review", { candidate_group_id: candidates.candidates[0].candidate_group_id, action: "keep_all" });
    expect(res.status).toBe(200);
    const sql = (mock as any).prepare.mock.calls.map((c: any) => c[0]).join("\n");
    expect(sql).not.toMatch(/UPDATE movements SET status='duplicate_excluded'/);
  });
});
