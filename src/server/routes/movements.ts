import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { applySavedCategoryRule, bulkUpdateMerchantCategoriesStatement, extractMerchantName, merchantRuleWrite, movementType, validateCategoryForType } from "../categorization-rules";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const OWNED_KINDS = new Set(["wallet", "deposit", "portfolio", "credit_card", "cicilan"]);

function jsonError(c: AppContext, error: string, status = 400) {
  return c.json({ error }, status as any);
}

async function parseJson(c: AppContext) {
  try { return await c.req.json(); } catch { throw new Error("Request body must be valid JSON"); }
}

function positiveAmount(v: any) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validDate(v: any) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function parseMovementId(v: any) { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }
function cleanText(v: any) { return v == null ? null : String(v).trim() || null; }
function nullableId(v: any) { if (v == null || v === "") return null; const n = Number(v); return Number.isInteger(n) && n > 0 ? n : NaN; }

function validateMovementBody(body: any): { value?: any; error?: string } {
  const amount = positiveAmount(body.amount);
  if (!amount) return { error: "Amount must be positive" };
  if (!validDate(body.date)) return { error: "Date must be YYYY-MM-DD" };
  const category_id = nullableId(body.category_id);
  if (Number.isNaN(category_id)) return { error: "Invalid category_id" };
  const src_kind = body.src_kind ?? null;
  const dst_kind = body.dst_kind ?? null;
  const src_id = nullableId(body.src_id);
  const dst_id = nullableId(body.dst_id);
  if (Number.isNaN(src_id) || Number.isNaN(dst_id)) return { error: "Invalid account id" };
  if (!src_kind && !dst_kind) return { error: "At least one of src/dst required" };
  if ((src_kind == null) !== (src_id == null)) return { error: "src_kind and src_id must be provided together" };
  if ((dst_kind == null) !== (dst_id == null)) return { error: "dst_kind and dst_id must be provided together" };
  if (src_kind && !OWNED_KINDS.has(src_kind)) return { error: "Invalid src_kind" };
  if (dst_kind && !OWNED_KINDS.has(dst_kind)) return { error: "Invalid dst_kind" };
  return { value: { amount, date: body.date, description: cleanText(body.description), category_id, src_kind, src_id, dst_kind, dst_id, apply_merchant_rule: !!body.apply_merchant_rule, update_existing_merchant: !!body.update_existing_merchant } };
}

async function validateRefs(c: AppContext, uid: number, m: any) {
  if (m.category_id != null) {
    const cat = await c.env.DB.prepare("SELECT id FROM categories WHERE user_id=? AND id=?").bind(uid, m.category_id).first<any>();
    if (!cat) return "Category not found";
  }
  for (const side of ["src", "dst"] as const) {
    const kind = m[`${side}_kind`], id = m[`${side}_id`];
    if (kind === "wallet") {
      const w = await c.env.DB.prepare("SELECT id FROM wallets WHERE user_id=? AND id=?").bind(uid, id).first<any>();
      if (!w) return "Wallet not found";
    }
  }
  return null;
}

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const walletId = c.req.query("wallet_id");
  const category = c.req.query("category");
  const month = c.req.query("month");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const q = c.req.query("q");
  const includeExcluded = c.req.query("include_excluded") === "true";

  let sql = "SELECT * FROM movements WHERE user_id = ?";
  const args: (string | number)[] = [uid];
  if (!includeExcluded) sql += " AND COALESCE(status,'active')='active'";
  if (walletId) { sql += " AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?))"; args.push(Number(walletId), Number(walletId)); }
  if (category && category !== "all") { sql += " AND category_id=?"; args.push(Number(category)); }
  if (month) { sql += " AND date LIKE ?"; args.push(`${month}%`); }
  if (dateFrom) { if (!validDate(dateFrom)) return jsonError(c, "Invalid date_from", 400); sql += " AND date>=?"; args.push(dateFrom); }
  if (dateTo) { if (!validDate(dateTo)) return jsonError(c, "Invalid date_to", 400); sql += " AND date<=?"; args.push(dateTo); }
  if (dateFrom && dateTo && dateFrom > dateTo) return jsonError(c, "date_from must be before or equal to date_to", 400);
  if (q) { sql += " AND description LIKE ?"; args.push(`%${q}%`); }
  sql += " ORDER BY date DESC, id DESC";
  const res = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(res.results);
});

app.post("/", async (c: AppContext) => {
  try {
    const uid = c.get("userId");
    const parsed = validateMovementBody(await parseJson(c));
    if (parsed.error) return jsonError(c, parsed.error);
    const refErr = await validateRefs(c, uid, parsed.value);
    if (refErr) return jsonError(c, refErr);
    const m = parsed.value;
    const type = movementType(m);
    const merchant = extractMerchantName(m.description);
    const wantsRule = m.apply_merchant_rule || m.update_existing_merchant;
    if (wantsRule) {
      if (!merchant || !m.category_id) return jsonError(c, "Merchant and category are required for automatic categorization");
      const catErr = await validateCategoryForType(c, uid, m.category_id, type);
      if (catErr) return jsonError(c, catErr);
    }
    const categorized = m.apply_merchant_rule ? m : await applySavedCategoryRule(c, uid, m);
    const writes = [c.env.DB.prepare(`INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uid, categorized.date, categorized.amount, categorized.description, categorized.category_id, categorized.src_kind, categorized.src_id, categorized.dst_kind, categorized.dst_id)];
    const rulePlan = m.apply_merchant_rule ? await merchantRuleWrite(c, uid, merchant!, m.category_id, type) : null;
    if (rulePlan) writes.push(rulePlan.statement);
    if (m.update_existing_merchant) writes.push(bulkUpdateMerchantCategoriesStatement(c, uid, merchant!, m.category_id, type));
    const results = await c.env.DB.batch(writes);
    const existing_updated = m.update_existing_merchant ? Number(results[results.length - 1]?.meta?.changes ?? 0) : 0;
    const insertedRuleId = rulePlan && rulePlan.action === "created" ? results[1]?.meta?.last_row_id ?? null : null;
    const rule = rulePlan ? { action: rulePlan.action, id: rulePlan.existingId ?? insertedRuleId } : null;
    return c.json({ success: true, id: results[0].meta.last_row_id, transaction_saved: true, rule, existing_updated, applied_rule_id: categorized.applied_rule_id ?? null }, 201);
  } catch { return jsonError(c, "Unable to create movement", 500); }
});

app.post("/batch", async (c: AppContext) => {
  const uid = c.get("userId");
  let body: any;
  try { body = await parseJson(c); } catch { return jsonError(c, "Request body must be valid JSON"); }
  const items = body.items;
  if (!Array.isArray(items) || !items.length) return jsonError(c, "items[] required");
  const prepared = [];
  for (const item of items) {
    const parsed = validateMovementBody(item);
    if (parsed.error) return jsonError(c, parsed.error);
    const refErr = await validateRefs(c, uid, parsed.value);
    if (refErr) return jsonError(c, refErr);
    const m = parsed.value;
    prepared.push(c.env.DB.prepare(`INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uid, m.date, m.amount, m.description, m.category_id, m.src_kind, m.src_id, m.dst_kind, m.dst_id));
  }
  try { await c.env.DB.batch(prepared); } catch { return jsonError(c, "Unable to create movements", 500); }
  return c.json({ created: items.length }, 201);
});

app.put("/:id", async (c: AppContext) => {
  try {
    const uid = c.get("userId");
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return jsonError(c, "Invalid movement ID", 400);
    const existing = await c.env.DB.prepare("SELECT id FROM movements WHERE id=? AND user_id=?").bind(id, uid).first<any>();
    if (!existing) return jsonError(c, "Movement not found", 404);
    const parsed = validateMovementBody(await parseJson(c));
    if (parsed.error) return jsonError(c, parsed.error);
    const refErr = await validateRefs(c, uid, parsed.value);
    if (refErr) return jsonError(c, refErr);
    const m = parsed.value;
    const type = movementType(m);
    const merchant = extractMerchantName(m.description);
    if (m.apply_merchant_rule || m.update_existing_merchant) {
      if (!merchant || !m.category_id) return jsonError(c, "Merchant and category are required for automatic categorization");
      const catErr = await validateCategoryForType(c, uid, m.category_id, type);
      if (catErr) return jsonError(c, catErr);
    }
    const writes = [c.env.DB.prepare(`UPDATE movements SET date=?, amount=?, description=?, category_id=?, src_kind=?, src_id=?, dst_kind=?, dst_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(m.date, m.amount, m.description, m.category_id, m.src_kind, m.src_id, m.dst_kind, m.dst_id, id, uid)];
    const rulePlan = m.apply_merchant_rule ? await merchantRuleWrite(c, uid, merchant!, m.category_id, type) : null;
    if (rulePlan) writes.push(rulePlan.statement);
    if (m.update_existing_merchant) writes.push(bulkUpdateMerchantCategoriesStatement(c, uid, merchant!, m.category_id, type));
    const results = await c.env.DB.batch(writes);
    const existing_updated = m.update_existing_merchant ? Number(results[results.length - 1]?.meta?.changes ?? 0) : 0;
    const insertedRuleId = rulePlan && rulePlan.action === "created" ? results[1]?.meta?.last_row_id ?? null : null;
    const rule = rulePlan ? { action: rulePlan.action, id: rulePlan.existingId ?? insertedRuleId } : null;
    return c.json({ success: true, id, transaction_saved: true, rule, existing_updated });
  } catch { return jsonError(c, "Unable to update movement", 500); }
});

const BULK_DELETE_LIMIT = 100;

async function deleteMovements(c: AppContext, uid: number, ids: number[]) {
  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) return { error: "movement_ids must not be empty", status: 400 };
  if (uniqueIds.length > BULK_DELETE_LIMIT) return { error: `Cannot delete more than ${BULK_DELETE_LIMIT} movements at once`, status: 400 };
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = (await c.env.DB.prepare(`SELECT id FROM movements WHERE user_id=? AND id IN (${placeholders})`).bind(uid, ...uniqueIds).all<any>()).results || [];
  const found = new Set(rows.map((r: any) => Number(r.id)));
  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length) return { error: "Movement not found", status: 404, missing_ids: missing };
  const stmts = uniqueIds.map((id) => c.env.DB.prepare("DELETE FROM movements WHERE id=? AND user_id=?").bind(id, uid));
  try { await c.env.DB.batch(stmts); } catch { return { error: "Unable to delete movement", status: 409 }; }
  return { requested_count: ids.length, deleted_count: uniqueIds.length, deleted_ids: uniqueIds };
}

app.post("/bulk-delete", async (c: AppContext) => {
  const uid = c.get("userId");
  let body: any;
  try { body = await parseJson(c); } catch { return jsonError(c, "Request body must be valid JSON"); }
  const rawIds = body.movement_ids;
  if (!Array.isArray(rawIds)) return jsonError(c, "movement_ids must be an array");
  const ids = rawIds.map(parseMovementId);
  if (ids.some((id: number | null) => id == null)) return jsonError(c, "Invalid movement ID", 400);
  const result: any = await deleteMovements(c, uid, ids as number[]);
  if (result.error) return c.json(result, result.status as any);
  return c.json({ success: true, ...result });
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = parseMovementId(c.req.param("id"));
  if (!id) return jsonError(c, "Invalid movement ID", 400);
  const result: any = await deleteMovements(c, uid, [id]);
  if (result.error) return c.json(result, result.status as any);
  return c.json({ success: true, deleted: true, id });
});

export default app;
