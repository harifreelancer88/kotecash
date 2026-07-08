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

  let sql = "SELECT * FROM movements WHERE user_id = ?";
  const args: (string | number)[] = [uid];
  if (search) { sql += " AND description LIKE ?"; args.push(`%${search}%`); }
  if (category && category !== "all") { sql += " AND category_id=?"; args.push(Number(category)); }
  if (type === "income") sql += " AND src_kind IS NULL";
  if (type === "expense") sql += " AND dst_kind IS NULL";
  sql += " ORDER BY date DESC, id DESC";

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
  }));
  return c.json(out);
});

export default app;
