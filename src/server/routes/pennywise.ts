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
const activeMovement = "COALESCE(m.status,'active')='active'";
async function hash(value: string) {
  const buf = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function stableGroupId(parts: any[]) {
  return "pwdup:" + parts.map((p) => String(p ?? "").replace(/[^a-zA-Z0-9._:-]/g, "_")).join(":").slice(0, 220);
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
  const rawSmsHash = clean(tx.raw_sms_hash, 160);
  const smsFingerprint = clean(tx.sms_fingerprint, 160);
  const smsKey = smsFingerprint || rawSmsHash;
  const txTime = clean(tx.transaction_time, 16);
  const financial = await hash([tx.transaction_date, txTime ?? "", amount, tx.direction, tx.wallet_id ?? "", tx.destination_wallet_id ?? "", clean(tx.reference_number, 80) ?? "", clean(tx.merchant, 120) ?? ""].join("|"));
  const request = await hash(JSON.stringify({ ...tx, amount }));
  let duplicate_status = "none";
  let existing: any = null;
  if (tx.client_transaction_id) existing = await c.env.DB.prepare("SELECT * FROM pennywise_sync_records WHERE user_id=? AND client_id=? AND client_transaction_id=?").bind(uid, clientId, tx.client_transaction_id).first();
  if (!existing && smsKey) existing = await c.env.DB.prepare("SELECT * FROM pennywise_sync_records WHERE user_id=? AND sms_fingerprint=?").bind(uid, smsKey).first();
  if (existing?.movement_id) duplicate_status = "already_synced";
  if (!existing) {
    const dup = await c.env.DB.prepare("SELECT id, movement_id FROM pennywise_sync_records WHERE user_id=? AND financial_fingerprint=? AND sync_status IN ('created','already_synced')").bind(uid, financial).first();
    if (dup) duplicate_status = "possible_duplicate";
  }
  return { issues, unsupported, source, amount, financial, request, smsKey, smsFingerprint, rawSmsHash, txTime, duplicate_status, existing, movement: issues.length ? null : movementFor(tx) };
}

function movementWallet(m: any) {
  if (m.src_kind === "wallet") return m.src_id;
  if (m.dst_kind === "wallet") return m.dst_id;
  return null;
}
function evidenceFor(rows: any[]) {
  const vals = (f: string) => [...new Set(rows.map((r) => r[f] ?? null).filter((v) => v !== null && v !== ""))];
  const matching_fields: string[] = [];
  const differing_fields: string[] = [];
  for (const f of ["transaction_date", "transaction_time", "amount", "wallet_id", "merchant", "reference_number", "sms_fingerprint", "raw_sms_hash", "client_id", "client_transaction_id", "source"]) {
    const v = vals(f);
    if (v.length === 1) matching_fields.push(f);
    else if (v.length > 1) differing_fields.push(f);
  }
  const sameSms = vals("sms_fingerprint").length === 1 || vals("raw_sms_hash").length === 1;
  const sameClient = vals("client_id").length === 1 && vals("client_transaction_id").length === 1;
  const sameReference = ["transaction_date","amount","wallet_id","merchant","reference_number"].every((f) => matching_fields.includes(f));
  const times = vals("transaction_time");
  let confidence: "confirmed"|"high"|"medium"|"low" = "medium";
  let classification = "probable duplicate";
  let reason = "Same date, wallet, amount, merchant, and reference number.";
  if (sameSms || sameClient) { confidence = "confirmed"; classification = "confirmed duplicate"; reason = "Same stable SMS/client idempotency key appears on multiple movements."; }
  else if (sameReference && times.length > 1) { confidence = "low"; classification = "legitimate repeated transaction"; reason = "Core fields match but transaction times differ, which can be valid for repeated transit payments."; }
  else if (sameReference) { confidence = "high"; classification = "probable duplicate"; }
  return { matching_fields, differing_fields, confidence, classification, reason, recommended_review_action: confidence === "low" ? "keep_all" : "mark_duplicate" };
}
function movementOut(r: any) {
  return {
    movement_id: r.movement_id, date: r.transaction_date, time: r.transaction_time ?? null, amount: r.amount,
    wallet_id: r.wallet_id, wallet_name: r.wallet_name ?? null, merchant: r.merchant || r.description,
    reference_number: r.reference_number ?? null, description: r.description, source: r.source,
    status: r.movement_status || "active", created_at: r.movement_created_at, duplicate_of_movement_id: r.duplicate_of_movement_id ?? null,
  };
}
function syncOut(r: any) {
  return {
    sync_record_id: r.sync_record_id, movement_id: r.movement_id, client_id: r.client_id,
    client_transaction_id: r.client_transaction_id, sms_fingerprint: r.sms_fingerprint,
    raw_sms_hash: r.raw_sms_hash ?? null, reference_number: r.reference_number ?? null,
    financial_fingerprint: r.financial_fingerprint ?? null, transaction_date: r.transaction_date,
    transaction_time: r.transaction_time ?? null, amount: r.amount, merchant: r.merchant ?? null,
    sync_status: r.sync_status, source: r.source, created_at: r.sync_created_at, updated_at: r.sync_updated_at,
  };
}
async function candidateRows(c: AppContext, uid: number) {
  const wh = [`m.user_id=?`, activeMovement, `p.id IS NOT NULL`];
  const args: any[] = [uid];
  const from = c.req.query("date_from"); if (from) { wh.push("m.date>=?"); args.push(from); }
  const to = c.req.query("date_to"); if (to) { wh.push("m.date<=?"); args.push(to); }
  const walletId = c.req.query("wallet_id"); if (walletId) { wh.push("((m.src_kind='wallet' AND m.src_id=?) OR (m.dst_kind='wallet' AND m.dst_id=?))"); args.push(walletId, walletId); }
  const res = await c.env.DB.prepare(`
    SELECT m.id movement_id, m.date transaction_date, m.amount, m.description, m.src_kind, m.src_id, m.dst_kind, m.dst_id,
           COALESCE(m.status,'active') movement_status, m.created_at movement_created_at, m.duplicate_of_movement_id,
           w.name wallet_name, p.id sync_record_id, p.client_id, p.client_transaction_id, p.sms_fingerprint,
           p.raw_sms_hash, p.sync_status, p.source, p.financial_fingerprint, p.reference_number, p.merchant,
           p.transaction_time, p.created_at sync_created_at, p.updated_at sync_updated_at
    FROM movements m
    JOIN pennywise_sync_records p ON p.user_id=m.user_id AND p.movement_id=m.id
    LEFT JOIN wallets w ON w.user_id=m.user_id AND w.id=CASE WHEN m.src_kind='wallet' THEN m.src_id WHEN m.dst_kind='wallet' THEN m.dst_id ELSE NULL END
    WHERE ${wh.join(" AND ")}
    ORDER BY m.date DESC,m.id DESC
  `).bind(...args).all<any>();
  return (res.results || []).map((r: any) => ({ ...r, wallet_id: movementWallet(r), merchant: r.merchant || String(r.description || "").split("|")[0].trim() }));
}
function buildCandidates(rows: any[], reviewRows: any[] = []) {
  const reviewed = new Map(reviewRows.map((r: any) => [r.candidate_group_id, r]));
  const buckets = new Map<string, any[]>();
  for (const r of rows) {
    const key = r.sms_fingerprint || r.raw_sms_hash
      ? `sms:${r.sms_fingerprint || r.raw_sms_hash}`
      : `shape:${r.transaction_date}|${r.amount}|${r.wallet_id || ""}|${String(r.reference_number || "").toLowerCase()}|${String(r.merchant || "").toLowerCase()}`;
    buckets.set(key, [...(buckets.get(key) || []), r]);
  }
  const out: any[] = [];
  for (const [key, arr] of buckets) {
    if (arr.length < 2) continue;
    const ids = arr.map((r) => r.movement_id).sort((a, b) => a - b);
    const ev = evidenceFor(arr);
    const groupId = stableGroupId([key, ...ids]);
    const review = reviewed.get(groupId) || null;
    out.push({
      candidate_group_id: groupId,
      classification: ev.classification,
      confidence: ev.confidence,
      reason: ev.reason,
      recommended_review_action: ev.recommended_review_action,
      matching_fields: ev.matching_fields,
      differing_fields: ev.differing_fields,
      current_review_action: review?.action || null,
      current_ledger_impact: arr.reduce((s, r) => s + Number(r.amount || 0), 0),
      involved_movements: arr.map(movementOut),
      involved_sync_records: arr.map(syncOut),
    });
  }
  return out.sort((a, b) => String(b.involved_movements[0]?.date || "").localeCompare(String(a.involved_movements[0]?.date || "")));
}
async function dependencyReport(c: AppContext, uid: number, retainedId: number, duplicateId: number, confidence: string) {
  const [retained, dup] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM movements WHERE user_id=? AND id=?").bind(uid, retainedId).first<any>(),
    c.env.DB.prepare("SELECT * FROM movements WHERE user_id=? AND id=?").bind(uid, duplicateId).first<any>(),
  ]);
  const blocks: any[] = [];
  if (!retained || !dup) blocks.push({ type: "movement_missing", reason: "Retained or duplicate movement not found" });
  if (retained && dup) {
    if (movementWallet(retained) !== movementWallet(dup)) blocks.push({ type: "wallet_mismatch", reason: "Movements use different wallets" });
    if (Number(retained.amount) !== Number(dup.amount)) blocks.push({ type: "amount_mismatch", reason: "Movements use different amounts" });
    if (confidence !== "confirmed" && confidence !== "high") blocks.push({ type: "insufficient_evidence", reason: "Candidate confidence is insufficient for exclusion" });
  }
  const lockedRecons = await c.env.DB.prepare(`SELECT r.id,r.status,r.locked FROM account_reconciliation_rows rr JOIN account_reconciliations r ON r.id=rr.reconciliation_id AND r.user_id=rr.user_id WHERE rr.user_id=? AND rr.movement_id=? AND (r.locked=1 OR r.status='locked')`).bind(uid, duplicateId).all<any>();
  if (lockedRecons.results?.length) blocks.push({ type: "locked_reconciliation", records: lockedRecons.results });
  const lockedSnapshots = dup ? await c.env.DB.prepare("SELECT id,month,snapshot_date FROM net_worth_snapshots WHERE user_id=? AND locked=1 AND date(snapshot_date)>=date(?) LIMIT 10").bind(uid, dup.date).all<any>() : { results: [] };
  if (lockedSnapshots.results?.length) blocks.push({ type: "locked_net_worth_snapshot", records: lockedSnapshots.results });
  const linked: any = {};
  for (const [name, sql] of Object.entries({
    liability_payments: "SELECT id FROM liability_payments WHERE user_id=? AND movement_id=? LIMIT 5",
    goal_contributions: "SELECT id FROM goal_contributions WHERE user_id=? AND movement_id=? LIMIT 5",
    income_allocations: "SELECT id FROM income_occurrence_allocations WHERE user_id=? AND movement_id=? LIMIT 5",
    investment_transactions: "SELECT id FROM investment_transactions WHERE user_id=? AND movement_id=? LIMIT 5",
    movement_allocations: "SELECT id FROM movement_allocations WHERE user_id=? AND movement_id=? LIMIT 5",
    import_rows: "SELECT id FROM financial_import_rows WHERE user_id=? AND created_record_type='movement' AND created_record_id=? LIMIT 5",
  })) {
    const r = await c.env.DB.prepare(sql).bind(uid, duplicateId).all<any>();
    if (r.results?.length) linked[name] = r.results;
  }
  if (Object.keys(linked).length) blocks.push({ type: "downstream_links", records: linked });
  return { blocked: blocks.length > 0, blocks, retained_movement: retained, duplicate_movement: dup };
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
        await c.env.DB.prepare(`INSERT INTO pennywise_sync_records (user_id,client_id,client_transaction_id,sms_fingerprint,raw_sms_hash,transaction_time,sync_status,direction,amount,transaction_date,source,error_code,error_message,request_fingerprint,financial_fingerprint,reference_number,merchant) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id,client_transaction_id) DO UPDATE SET sync_status=excluded.sync_status,error_code=excluded.error_code,error_message=excluded.error_message,raw_sms_hash=COALESCE(excluded.raw_sms_hash,pennywise_sync_records.raw_sms_hash),transaction_time=COALESCE(excluded.transaction_time,pennywise_sync_records.transaction_time),updated_at=datetime('now')`).bind(uid, body.client_id, tx.client_transaction_id, a.smsKey ?? null, a.rawSmsHash ?? null, a.txTime ?? null, status, tx.direction ?? "expense", a.amount, tx.transaction_date ?? "0000-00-00", a.source, status, a.issues.join("; "), a.request, a.financial, clean(tx.reference_number,80), clean(tx.merchant,120)).run();
        results.push({ client_transaction_id: tx.client_transaction_id, status, error: a.issues.join("; ") }); continue;
      }
      await c.env.DB.prepare(`INSERT INTO pennywise_sync_records (user_id,client_id,client_transaction_id,sms_fingerprint,raw_sms_hash,transaction_time,sync_status,direction,amount,transaction_date,source,request_fingerprint,financial_fingerprint,reference_number,merchant) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id,client_transaction_id) DO UPDATE SET sync_status=excluded.sync_status,request_fingerprint=excluded.request_fingerprint,financial_fingerprint=excluded.financial_fingerprint,raw_sms_hash=COALESCE(excluded.raw_sms_hash,pennywise_sync_records.raw_sms_hash),transaction_time=COALESCE(excluded.transaction_time,pennywise_sync_records.transaction_time),updated_at=datetime('now')`).bind(uid, body.client_id, tx.client_transaction_id, a.smsKey ?? null, a.rawSmsHash ?? null, a.txTime ?? null, "syncing", tx.direction, a.amount, tx.transaction_date, a.source, a.request, a.financial, clean(tx.reference_number,80), clean(tx.merchant,120)).run();
      const m = a.movement!;
      const ins = await c.env.DB.prepare(`INSERT INTO movements (user_id,date,amount,description,category_id,src_kind,src_id,dst_kind,dst_id) VALUES (?,?,?,?,?,?,?,?,?)`).bind(uid, m.date, m.amount, m.description, m.category_id, m.src_kind, m.src_id, m.dst_kind, m.dst_id).run();
      const movementId = ins.meta.last_row_id;
      await c.env.DB.prepare(`INSERT INTO pennywise_sync_records (user_id,client_id,client_transaction_id,sms_fingerprint,raw_sms_hash,transaction_time,movement_id,sync_status,direction,amount,transaction_date,source,request_fingerprint,financial_fingerprint,reference_number,merchant) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,client_id,client_transaction_id) DO UPDATE SET movement_id=excluded.movement_id,sync_status='created',error_code=NULL,error_message=NULL,raw_sms_hash=COALESCE(excluded.raw_sms_hash,pennywise_sync_records.raw_sms_hash),transaction_time=COALESCE(excluded.transaction_time,pennywise_sync_records.transaction_time),updated_at=datetime('now')`).bind(uid, body.client_id, tx.client_transaction_id, a.smsKey ?? null, a.rawSmsHash ?? null, a.txTime ?? null, movementId, "created", tx.direction, a.amount, tx.transaction_date, a.source, a.request, a.financial, clean(tx.reference_number,80), clean(tx.merchant,120)).run();
      results.push({ client_transaction_id: tx.client_transaction_id, status: "created", movement_id: movementId });
    } catch (e: any) { results.push({ client_transaction_id: tx.client_transaction_id, status: "server_error", error: "Sync failed" }); }
  }
  return c.json({ results }, 207);
});

app.get("/status", async (c: AppContext) => {
  const uid = c.get("userId");
  let sql = "SELECT id,client_id,client_transaction_id,sms_fingerprint,raw_sms_hash,transaction_time,movement_id,sync_status,direction,amount,transaction_date,source,error_code,error_message,financial_fingerprint,reference_number,merchant,created_at,updated_at FROM pennywise_sync_records WHERE user_id=?";
  const args: any[] = [uid];
  for (const [q, col] of [["client_transaction_id","client_transaction_id"],["sms_fingerprint","sms_fingerprint"],["sync_status","sync_status"]] as any) { const v = c.req.query(q); if (v) { sql += ` AND ${col}=?`; args.push(v); } }
  const from = c.req.query("from"); if (from) { sql += " AND transaction_date>=?"; args.push(from); }
  const to = c.req.query("to"); if (to) { sql += " AND transaction_date<=?"; args.push(to); }
  sql += " ORDER BY transaction_date DESC, id DESC LIMIT 200";
  const rows = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ results: rows.results });
});

app.get("/duplicate-candidates", async (c: AppContext) => {
  const uid = c.get("userId");
  const rows = await candidateRows(c, uid);
  const reviews = await c.env.DB.prepare("SELECT * FROM pennywise_duplicate_reviews WHERE user_id=? ORDER BY reviewed_at DESC,id DESC").bind(uid).all<any>().catch(() => ({ results: [] }));
  let candidates = buildCandidates(rows, reviews.results || []);
  const confidence = c.req.query("confidence");
  if (confidence) candidates = candidates.filter((g) => g.confidence === confidence);
  if (c.req.query("unresolved_only") !== "false") candidates = candidates.filter((g) => !["keep_all","ignore","mark_duplicate"].includes(g.current_review_action || ""));
  return c.json({ candidates });
});

app.post("/duplicate-candidates/review", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (!["keep_all","mark_duplicate","ignore","defer"].includes(action)) return c.json({ error: "Invalid action" }, 400);
  if (!body.candidate_group_id) return c.json({ error: "candidate_group_id required" }, 400);

  const rows = await candidateRows(c, uid);
  const candidates = buildCandidates(rows, []);
  const candidate = candidates.find((g) => g.candidate_group_id === body.candidate_group_id);
  if (!candidate && action === "mark_duplicate") {
    const retainedId = Number(body.retained_movement_id);
    const duplicateId = Number(body.duplicate_movement_id);
    const existing = await c.env.DB.prepare("SELECT status,duplicate_of_movement_id FROM movements WHERE user_id=? AND id=?").bind(uid, duplicateId).first<any>();
    if (existing?.status === "duplicate_excluded" && Number(existing.duplicate_of_movement_id) === retainedId) {
      return c.json({ success: true, idempotent: true, action, retained_movement_id: retainedId, duplicate_movement_id: duplicateId });
    }
  }
  if (!candidate) return c.json({ error: "Candidate not found or already resolved" }, 404);
  const confidence = candidate.confidence;
  const reason = body.reason || candidate.reason;

  if (action !== "mark_duplicate") {
    await c.env.DB.prepare(`INSERT INTO pennywise_duplicate_reviews (user_id,candidate_group_id,action,confidence,reason,impact_json) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,candidate_group_id,action,duplicate_movement_id) DO UPDATE SET reviewed_at=datetime('now'), reason=excluded.reason`).bind(uid, body.candidate_group_id, action, confidence, reason, JSON.stringify({ current_ledger_impact: candidate.current_ledger_impact })).run();
    await c.env.DB.prepare("INSERT INTO pennywise_duplicate_audit_events (user_id,candidate_group_id,event_type,summary_json) VALUES (?,?,?,?)").bind(uid, body.candidate_group_id, `duplicate_${action}`, JSON.stringify({ action, reason })).run();
    return c.json({ success: true, action, candidate_group_id: body.candidate_group_id });
  }

  if (body.confirm !== true) return c.json({ error: "Explicit confirmation required" }, 400);
  const retainedId = Number(body.retained_movement_id);
  const duplicateId = Number(body.duplicate_movement_id);
  if (!retainedId || !duplicateId || retainedId === duplicateId) return c.json({ error: "retained_movement_id and duplicate_movement_id are required and must differ" }, 400);
  if (!candidate.involved_movements.some((m: any) => m.movement_id === retainedId) || !candidate.involved_movements.some((m: any) => m.movement_id === duplicateId)) return c.json({ error: "Selected movements are not in the candidate group" }, 400);

  const deps = await dependencyReport(c, uid, retainedId, duplicateId, confidence);
  const impact = deps.duplicate_movement ? {
    balance_impact: Number(deps.duplicate_movement.amount || 0),
    cash_flow_impact: Number(deps.duplicate_movement.amount || 0),
    budget_impact: Number(deps.duplicate_movement.amount || 0),
    retained_movement_id: retainedId,
    duplicate_movement_id: duplicateId,
  } : {};
  if (deps.blocked) {
    await c.env.DB.prepare(`INSERT INTO pennywise_duplicate_reviews (user_id,candidate_group_id,action,retained_movement_id,duplicate_movement_id,confidence,reason,dependency_report_json,impact_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,candidate_group_id,action,duplicate_movement_id) DO UPDATE SET dependency_report_json=excluded.dependency_report_json,reviewed_at=datetime('now')`).bind(uid, body.candidate_group_id, "defer", retainedId, duplicateId, confidence, "Resolution blocked by dependencies", JSON.stringify(deps), JSON.stringify(impact)).run();
    return c.json({ error: "Duplicate resolution blocked", dependency_report: deps, impact }, 409);
  }

  const existing = await c.env.DB.prepare("SELECT status,duplicate_of_movement_id FROM movements WHERE user_id=? AND id=?").bind(uid, duplicateId).first<any>();
  if (existing?.status === "duplicate_excluded" && Number(existing.duplicate_of_movement_id) === retainedId) {
    return c.json({ success: true, idempotent: true, action, retained_movement_id: retainedId, duplicate_movement_id: duplicateId, impact });
  }
  await c.env.DB.prepare(`UPDATE movements SET status='duplicate_excluded', duplicate_of_movement_id=?, excluded_at=datetime('now'), excluded_reason=?, exclusion_source='pennywise_duplicate_review', updated_at=datetime('now') WHERE user_id=? AND id=?`).bind(retainedId, reason, uid, duplicateId).run();
  await c.env.DB.prepare(`INSERT INTO pennywise_duplicate_reviews (user_id,candidate_group_id,action,retained_movement_id,duplicate_movement_id,confidence,reason,dependency_report_json,impact_json) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,candidate_group_id,action,duplicate_movement_id) DO UPDATE SET reviewed_at=datetime('now'), reason=excluded.reason, impact_json=excluded.impact_json`).bind(uid, body.candidate_group_id, action, retainedId, duplicateId, confidence, reason, JSON.stringify(deps), JSON.stringify(impact)).run();
  await c.env.DB.prepare("INSERT INTO pennywise_duplicate_audit_events (user_id,candidate_group_id,movement_id,event_type,summary_json) VALUES (?,?,?,?,?)").bind(uid, body.candidate_group_id, duplicateId, "duplicate_marked", JSON.stringify({ retained_movement_id: retainedId, duplicate_movement_id: duplicateId, impact })).run();
  return c.json({ success: true, action, retained_movement_id: retainedId, duplicate_movement_id: duplicateId, impact });
});

app.get("/summary", async (c: AppContext) => {
  const uid = c.get("userId");
  const counts = await c.env.DB.prepare("SELECT sync_status, COUNT(*) count FROM pennywise_sync_records WHERE user_id=? GROUP BY sync_status").bind(uid).all();
  const clients = await c.env.DB.prepare("SELECT client_id, MAX(updated_at) last_seen_at, COUNT(*) records FROM pennywise_sync_records WHERE user_id=? GROUP BY client_id ORDER BY last_seen_at DESC LIMIT 20").bind(uid).all();
  const errors = await c.env.DB.prepare("SELECT client_transaction_id,error_code,error_message,updated_at FROM pennywise_sync_records WHERE user_id=? AND error_code IS NOT NULL ORDER BY updated_at DESC LIMIT 10").bind(uid).all();
  return c.json({ enabled: true, counts: counts.results, clients: clients.results, recent_errors: errors.results });
});

export default app;
