import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";

// READ-ONLY compatibility shim. The frontend (public/app.js) reads /api/transactions.
// Writes should target /api/movements. This maps movements → legacy transaction shape.
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const search = c.req.query("search");
  const category = c.req.query("category");
  const type = c.req.query("type");

  let sql = `SELECT m.*, p.sync_status as pennywise_sync_status, p.reference_number as pennywise_reference_number
             FROM movements m
             LEFT JOIN pennywise_sync_records p ON p.user_id=m.user_id AND p.movement_id=m.id
             WHERE m.user_id = ?`;
  const args: (string | number)[] = [uid];
  if (search) { sql += " AND m.description LIKE ?"; args.push(`%${search}%`); }
  if (category && category !== "all") { sql += " AND m.category_id=?"; args.push(Number(category)); }
  if (type === "income") sql += " AND m.src_kind IS NULL";
  if (type === "expense") sql += " AND m.dst_kind IS NULL";
  sql += " ORDER BY m.date DESC, m.id DESC";

  const res = await c.env.DB.prepare(sql).bind(...args).all<any>();
  const out = res.results.map((m: any) => ({
    id: m.id,
    date: m.date,
    category_id: m.category_id,
    description: m.description,
    amount: m.amount,
    payment_method: null,
    type: m.src_kind === null ? "income" : "expense",
    cicilan_id: m.dst_kind === "cicilan" ? m.dst_id : null,
    source: m.pennywise_sync_status ? "pennywise_sms" : null,
    sync_status: m.pennywise_sync_status ?? null,
    reference_number: m.pennywise_reference_number ?? null,
  }));
  return c.json(out);
});

export default app;
