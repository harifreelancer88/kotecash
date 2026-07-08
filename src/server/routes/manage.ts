import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { budgetStatus } from "../formulas";

// ---- Categories ----
export const categories = new Hono<{ Bindings: Bindings; Variables: Variables }>();

categories.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT * FROM categories WHERE user_id=? ORDER BY id"
  )
    .bind(uid)
    .all();
  return c.json(res.results);
});

categories.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const res = await c.env.DB.prepare(
    "INSERT INTO categories (user_id, name, type, is_debt_service) VALUES (?, ?, ?, ?)"
  )
    .bind(uid, body.name, body.type, body.is_debt_service ? 1 : 0)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

categories.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE categories SET name=?, type=?, is_debt_service=? WHERE id=? AND user_id=?"
  )
    .bind(body.name, body.type, body.is_debt_service ? 1 : 0, id, uid)
    .run();
  return c.json({ success: true });
});

categories.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) as n FROM movements WHERE user_id=? AND category_id=?"
  )
    .bind(uid, id)
    .first<{ n: number }>();
  await c.env.DB.prepare(
    "UPDATE movements SET category_id=NULL WHERE user_id=? AND category_id=?"
  )
    .bind(uid, id)
    .run();
  await c.env.DB.prepare("DELETE FROM categories WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true, uncategorized: count?.n ?? 0 });
});

// ---- Budgets ----
export const budgets = new Hono<{ Bindings: Bindings; Variables: Variables }>();
import { currentMonth } from "../types";

budgets.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const month = c.req.query("month") || currentMonth();
  const res = await c.env.DB.prepare(
    `SELECT b.*, c.name as category_name, c.is_debt_service
     FROM budgets b JOIN categories c ON c.id = b.category_id
     WHERE b.user_id=? AND b.month=? AND c.is_debt_service=0
     ORDER BY b.id`
  )
    .bind(uid, month)
    .all();

  const actuals = await c.env.DB.prepare(
    `SELECT category_id, SUM(amount) as spent FROM movements
     WHERE user_id=? AND date BETWEEN ? AND ? AND dst_kind IS NULL
     GROUP BY category_id`
  )
    .bind(uid, `${month}-01`, `${month}-31`)
    .all<{ category_id: number; spent: number }>();
  const actualMap = new Map<number, number>();
  for (const a of actuals.results) actualMap.set(a.category_id, a.spent);

  const out = res.results.map((b: any) => {
    const actual = actualMap.get(b.category_id) ?? 0;
    return {
      ...b,
      actual,
      remaining: b.budget_amount - actual,
      status: budgetStatus(actual, b.budget_amount),
    };
  });
  return c.json(out);
});

budgets.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const month = body.month || currentMonth();
  const res = await c.env.DB.prepare(
    `INSERT INTO budgets (user_id, category_id, budget_amount, month)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, category_id, month) DO UPDATE SET budget_amount=excluded.budget_amount`
  )
    .bind(uid, body.category_id, body.budget_amount, month)
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

budgets.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE budgets SET budget_amount=? WHERE id=? AND user_id=?"
  )
    .bind(body.budget_amount, id, uid)
    .run();
  return c.json({ success: true });
});

budgets.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM budgets WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true });
});

// ---- Earmarks delete ----
export const earmarks = new Hono<{ Bindings: Bindings; Variables: Variables }>();

earmarks.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM earmarks WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true });
});
