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
});
