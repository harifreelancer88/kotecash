import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const MAX_BATCH = 100;
const VALID_DIRECTIONS = new Set(["expense", "income", "transfer"]);
const UNSUPPORTED_TYPES = new Set(["investment", "otp", "promo", "balance", "non_financial"]);
const ALLOWED = new Set([
  "client_transaction_id", "sms_fingerprint", "transaction_date", "transaction_time", "amount", "direction",
  "wallet_id", "destination_wallet_id", "category_id", "merchant", "description", "reference_number", "bank_name",
  "account_masked", "source", "raw_sms_hash", "metadata", "transaction_type", "confidence", "is_failed_transaction"
]);

type Tx = Record<string, any>;
const clean = (s: any, max = 160) => typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : null;
const dateOk = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const finiteAmount = (n: any) => typeof n === "number" && Number.isFinite(n) && n > 0;
async function hash(value: string) {
  const buf = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function walletExists(c: AppContext, uid: number, id: any) {
  if (!id) return false;
  const row = await c.env.DB.prepare("SELECT id FROM wallets WHERE id=? AND user_id=?").bind(Number(id), uid).first();
  return !!row;
}
async function categoryExists(c: AppContext, uid: number, id: any) {
  if (!id) return true;
  const row = await c.env.DB.prepare("SELECT id FROM categories WHERE id=? AND user_id=?").bind(Number(id), uid).first();
  return !!row;
}
function validatePayload(body: any): string | null {
  if (!body || typeof body !== "object") return "JSON object required";
  if (!body.client_id || typeof body.client_id !== "string") return "client_id required";
  if (!Array.isArray(body.transactions) || body.transactions.length === 0) return "transactions[] required";
  if (body.transactions.length > MAX_BATCH) return `transactions[] limited to ${MAX_BATCH}`;
  return null;
}
function baseIssues(tx: Tx) {
  const issues: string[] = [];
  for (const k of Object.keys(tx)) if (!ALLOWED.has(k)) issues.push(`unknown field: ${k}`);
  if (!tx.client_transaction_id || typeof tx.client_transaction_id !== "string") issues.push("client_transaction_id required");
  if (!dateOk(tx.transaction_date)) issues.push("transaction_date must be YYYY-MM-DD");
  if (!finiteAmount(tx.amount)) issues.push("amount must be a positive finite number");
  if (!VALID_DIRECTIONS.has(tx.direction)) issues.push("direction must be expense, income, or transfer");
  if (tx.raw_sms || tx.sms_body || tx.raw_sms_text) issues.push("raw SMS body is not accepted");
  return issues;
}
function movementFor(tx: Tx) {
  const amount = Math.round(Number(tx.amount));
  const description = clean(tx.description, 240) || clean(tx.merchant, 120) || "PennyWise SMS transaction";
  if (tx.direction === "expense") return { date: tx.transaction_date, amount, description, category_id: tx.category_id ?? null, src_kind: "wallet", src_id: Number(tx.wallet_id), dst_kind: null, dst_id: null };
  if (tx.direction === "income") return { date: tx.transaction_date, amount, description, category_id: tx.category_id ?? null, src_kind: null, src_id: null, dst_kind: "wallet", dst_id: Number(tx.wallet_id) };
  return { date: tx.transaction_date, amount, description, category_id: tx.category_id ?? null, src_kind: "wallet", src_id: Number(tx.wallet_id), dst_kind: "wallet", dst_id: Number(tx.destination_wallet_id) };
}
async function analyze(c: AppContext, uid: number, clientId: string, tx: Tx) {
  const issues = baseIssues(tx);
  const source = clean(tx.source, 24) || "sms";
  const unsupported = tx.is_failed_transaction ? "failed_transaction" : UNSUPPORTED_TYPES.has(tx.transaction_type) ? "unsupported_for_ledger" : null;
  if (unsupported) issues.push(unsupported);
  if (tx.direction === "transfer" && (!tx.wallet_id || !tx.destination_wallet_id)) issues.push("source and destination wallet mappings required");
  if (tx.direction !== "transfer" && !tx.wallet_id) issues.push("wallet mapping required");
  if (tx.wallet_id && !(await walletExists(c, uid, tx.wallet_id))) issues.push("wallet mapping missing");
  if (tx.destination_wallet_id && !(await walletExists(c, uid, tx.destination_wallet_id))) issues.push("destination wallet mapping missing");
  if (!(await categoryExists(c, uid, tx.category_id))) issues.push("category ownership invalid");
  const amount = Math.round(Number(tx.amount || 0));
  const financial = await hash([tx.transaction_date, amount, tx.direction, tx.wallet_id ?? "", tx.destination_wallet_id ?? "", clean(tx.reference_number, 80) ?? "", clean(tx.merchant, 120) ?? ""].join("|"));
  const request = await hash(JSON.stringify({ ...tx, amount }));
  let duplicate_status = "none";
  let existing: any = null;
  if (tx.client_transaction_id) existing = await c.env.DB.prepare("SELECT * FROM pennywise_sync_records WHERE user_id=? AND client_id=? AND client_transaction_id=?").bind(uid, clientId, tx.client_transaction_id).first();
  if (!existing && tx.sms_fingerprint) existing = await c.env.DB.prepare("SELECT * FROM pennywise_sync_records WHERE user_id=? AND sms_fingerprint=?").bind(uid, tx.sms_fingerprint).first();
  if (existing?.movement_id) duplicate_status = "already_synced";
  if (!existing) {
    const dup = await c.env.DB.prepare("SELECT id, movement_id FROM pennywise_sync_records WHERE user_id=? AND financial_fingerprint=? AND sync_status IN ('created','already_synced')").bind(uid, financial).first();
    if (dup) duplicate_status = "possible_duplicate";
  }
  return { issues, unsupported, source, amount, financial, request, duplicate_status, existing, movement: issues.length ? null : movementFor(tx) };
}

app.post("/preview", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const err = validatePayload(body); if (err) return c.json({ error: err }, 400);
  const results = [];
  for (const tx of body.transactions) {
    const a = await analyze(c, uid, body.client_id, tx);
    results.push({ client_transaction_id: tx.client_transaction_id, normalized_direction: tx.direction, duplicate_status: a.duplicate_status, validation_issues: a.issues, supported: !a.unsupported && a.issues.length === 0, proposed_movement: a.movement, warnings: a.duplicate_status === "possible_duplicate" ? ["Similar synced transaction exists"] : [] });
  }
  return c.json({ results });
});

app.post("/movements", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const err = validatePayload(body); if (err) return c.json({ error: err }, 400);
  const results = [];
  for (const tx of body.transactions) {
    try {
      const a = await analyze(c, uid, body.client_id, tx);
      if (a.existing?.movement_id) { results.push({ client_transaction_id: tx.client_transaction_id, status: "already_synced", movement_id: a.existing.movement_id }); continue; }
      if (a.existing?.sync_status === "syncing") { results.push({ client_transaction_id: tx.client_transaction_id, status: "possible_duplicate", error: "Prior sync attempt may have created a movement; reconcile with status endpoint" }); continue; }
      const status = a.unsupported ? "validation_failed" : a.issues.some((i) => i.includes("mapping")) ? "mapping_missing" : a.duplicate_status === "possible_duplicate" ? "possible_duplicate" : a.issues.length ? "validation_failed" : "created";
      if (status !== "created") {
        await c.env.DB.prepare(`INSERT INTO pennywise_sync_records (user_id,client_id,client_transaction_id,sms_fingerprint,sync_status,direction,amount,transaction_date,source,error_code,error_message,request_fingerprint,financial_fingerprint,reference_number,merchant) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id,client_transaction_id) DO UPDATE SET sync_status=excluded.sync_status,error_code=excluded.error_code,error_message=excluded.error_message,updated_at=datetime('now')`).bind(uid, body.client_id, tx.client_transaction_id, tx.sms_fingerprint ?? null, status, tx.direction ?? "expense", a.amount, tx.transaction_date ?? "0000-00-00", a.source, status, a.issues.join("; "), a.request, a.financial, clean(tx.reference_number,80), clean(tx.merchant,120)).run();
        results.push({ client_transaction_id: tx.client_transaction_id, status, error: a.issues.join("; ") }); continue;
      }
      await c.env.DB.prepare(`INSERT INTO pennywise_sync_records (user_id,client_id,client_transaction_id,sms_fingerprint,sync_status,direction,amount,transaction_date,source,request_fingerprint,financial_fingerprint,reference_number,merchant) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id,client_transaction_id) DO UPDATE SET sync_status=excluded.sync_status,request_fingerprint=excluded.request_fingerprint,financial_fingerprint=excluded.financial_fingerprint,updated_at=datetime('now')`).bind(uid, body.client_id, tx.client_transaction_id, tx.sms_fingerprint ?? null, "syncing", tx.direction, a.amount, tx.transaction_date, a.source, a.request, a.financial, clean(tx.reference_number,80), clean(tx.merchant,120)).run();
      const m = a.movement!;
      const ins = await c.env.DB.prepare(`INSERT INTO movements (user_id,date,amount,description,category_id,src_kind,src_id,dst_kind,dst_id) VALUES (?,?,?,?,?,?,?,?,?)`).bind(uid, m.date, m.amount, m.description, m.category_id, m.src_kind, m.src_id, m.dst_kind, m.dst_id).run();
      const movementId = ins.meta.last_row_id;
      await c.env.DB.prepare(`INSERT INTO pennywise_sync_records (user_id,client_id,client_transaction_id,sms_fingerprint,movement_id,sync_status,direction,amount,transaction_date,source,request_fingerprint,financial_fingerprint,reference_number,merchant) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id,client_transaction_id) DO UPDATE SET movement_id=excluded.movement_id,sync_status='created',error_code=NULL,error_message=NULL,updated_at=datetime('now')`).bind(uid, body.client_id, tx.client_transaction_id, tx.sms_fingerprint ?? null, movementId, "created", tx.direction, a.amount, tx.transaction_date, a.source, a.request, a.financial, clean(tx.reference_number,80), clean(tx.merchant,120)).run();
      results.push({ client_transaction_id: tx.client_transaction_id, status: "created", movement_id: movementId });
    } catch (e: any) { results.push({ client_transaction_id: tx.client_transaction_id, status: "server_error", error: "Sync failed" }); }
  }
  return c.json({ results }, 207);
});

app.get("/status", async (c: AppContext) => {
  const uid = c.get("userId");
  let sql = "SELECT id,client_id,client_transaction_id,sms_fingerprint,movement_id,sync_status,direction,amount,transaction_date,source,error_code,error_message,created_at,updated_at FROM pennywise_sync_records WHERE user_id=?";
  const args: any[] = [uid];
  for (const [q, col] of [["client_transaction_id","client_transaction_id"],["sms_fingerprint","sms_fingerprint"],["sync_status","sync_status"]] as any) { const v = c.req.query(q); if (v) { sql += ` AND ${col}=?`; args.push(v); } }
  const from = c.req.query("from"); if (from) { sql += " AND transaction_date>=?"; args.push(from); }
  const to = c.req.query("to"); if (to) { sql += " AND transaction_date<=?"; args.push(to); }
  sql += " ORDER BY transaction_date DESC, id DESC LIMIT 200";
  const rows = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ results: rows.results });
});

app.get("/summary", async (c: AppContext) => {
  const uid = c.get("userId");
  const counts = await c.env.DB.prepare("SELECT sync_status, COUNT(*) count FROM pennywise_sync_records WHERE user_id=? GROUP BY sync_status").bind(uid).all();
  const clients = await c.env.DB.prepare("SELECT client_id, MAX(updated_at) last_seen_at, COUNT(*) records FROM pennywise_sync_records WHERE user_id=? GROUP BY client_id ORDER BY last_seen_at DESC LIMIT 20").bind(uid).all();
  const errors = await c.env.DB.prepare("SELECT client_transaction_id,error_code,error_message,updated_at FROM pennywise_sync_records WHERE user_id=? AND error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 10").bind(uid).all();
  return c.json({ enabled: true, counts: counts.results, clients: clients.results, recent_errors: errors.results });
});

export default app;
