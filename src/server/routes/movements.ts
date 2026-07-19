import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";

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

function validDate(v: any) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
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
  return { value: { amount, date: body.date, description: cleanText(body.description), category_id, src_kind, src_id, dst_kind, dst_id } };
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
  const q = c.req.query("q");
  const includeExcluded = c.req.query("include_excluded") === "true";

  let sql = "SELECT * FROM movements WHERE user_id = ?";
  const args: (string | number)[] = [uid];
  if (!includeExcluded) sql += " AND COALESCE(status,'active')='active'";
  if (walletId) { sql += " AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?))"; args.push(Number(walletId), Number(walletId)); }
  if (category && category !== "all") { sql += " AND category_id=?"; args.push(Number(category)); }
  if (month) { sql += " AND date LIKE ?"; args.push(`${month}%`); }
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
    const res = await c.env.DB.prepare(`INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uid, m.date, m.amount, m.description, m.category_id, m.src_kind, m.src_id, m.dst_kind, m.dst_id).run();
    return c.json({ id: res.meta.last_row_id }, 201);
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
    await c.env.DB.prepare(`UPDATE movements SET date=?, amount=?, description=?, category_id=?, src_kind=?, src_id=?, dst_kind=?, dst_id=?, updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(m.date, m.amount, m.description, m.category_id, m.src_kind, m.src_id, m.dst_kind, m.dst_id, id, uid).run();
    return c.json({ success: true, id });
  } catch { return jsonError(c, "Unable to update movement", 500); }
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM movements WHERE id=? AND user_id=?").bind(id, uid).run();
  return c.json({ success: true });
});

export default app;
