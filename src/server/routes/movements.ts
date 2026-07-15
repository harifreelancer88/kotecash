import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function validEndpoints(body: any): string | null {
  // returns error string or null; validates a single movement payload
  if (!body.amount || body.amount <= 0) return "Amount must be positive";
  if (!body.date) return "Date required";
  if (!body.src_kind && !body.dst_kind) return "At least one of src/dst required";
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
  if (walletId) {
    sql += " AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?))";
    args.push(Number(walletId), Number(walletId));
  }
  if (category && category !== "all") {
    sql += " AND category_id=?";
    args.push(Number(category));
  }
  if (month) {
    sql += " AND date LIKE ?";
    args.push(`${month}%`);
  }
  if (q) {
    sql += " AND description LIKE ?";
    args.push(`%${q}%`);
  }
  sql += " ORDER BY date DESC, id DESC";

  const res = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json(res.results);
});

app.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const err = validEndpoints(body);
  if (err) return c.json({ error: err }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(uid, body.date, body.amount, body.description ?? null, body.category_id ?? null,
          body.src_kind ?? null, body.src_id ?? null, body.dst_kind ?? null, body.dst_id ?? null)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.post("/batch", async (c: AppContext) => {
  const uid = c.get("userId");
  const { items } = await c.req.json();
  if (!Array.isArray(items) || !items.length)
    return c.json({ error: "items[] required" }, 400);
  const stmts = items.map((b: any) => {
    const err = validEndpoints(b);
    if (err) throw new Error(err);
    return c.env.DB.prepare(
      `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(uid, b.date, b.amount, b.description ?? null, b.category_id ?? null,
            b.src_kind ?? null, b.src_id ?? null, b.dst_kind ?? null, b.dst_id ?? null);
  });
  try {
    await c.env.DB.batch(stmts);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
  return c.json({ created: items.length }, 201);
});

app.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  const err = validEndpoints(body);
  if (err) return c.json({ error: err }, 400);
  await c.env.DB.prepare(
    `UPDATE movements SET date=?, amount=?, description=?, category_id=?, src_kind=?, src_id=?, dst_kind=?, dst_id=?
     WHERE id=? AND user_id=?`
  )
    .bind(body.date, body.amount, body.description ?? null, body.category_id ?? null,
          body.src_kind ?? null, body.src_id ?? null, body.dst_kind ?? null, body.dst_id ?? null,
          id, uid)
    .run();
  return c.json({ success: true });
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM movements WHERE id=? AND user_id=?").bind(id, uid).run();
  return c.json({ success: true });
});

export default app;
