import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { goalProgress, type Earmark } from "../formulas";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const goals = await c.env.DB.prepare(
    "SELECT * FROM goals WHERE user_id = ? ORDER BY id"
  )
    .bind(uid)
    .all<{ id: number; target_amount: number }>();
  const earmarks = await c.env.DB.prepare(
    "SELECT * FROM earmarks WHERE user_id = ?"
  )
    .bind(uid)
    .all<Earmark & { id: number }>();

  const out = goals.results.map((g) => {
    const progress = goalProgress(g.id, earmarks.results);
    const pct = g.target_amount > 0 ? progress / g.target_amount : 0;
    return {
      ...g,
      progress,
      pct,
      reached: progress >= g.target_amount,
      earmarks: earmarks.results.filter((e) => e.goal_id === g.id),
    };
  });
  return c.json(out);
});

app.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  if (!body.name || !body.target_amount || body.target_amount <= 0)
    return c.json({ error: "Name and positive target required" }, 400);
  const res = await c.env.DB.prepare(
    "INSERT INTO goals (user_id, name, target_amount, icon) VALUES (?, ?, ?, ?)"
  )
    .bind(uid, body.name, body.target_amount, body.icon ?? "target")
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE goals SET name=?, target_amount=?, icon=? WHERE id=? AND user_id=?"
  )
    .bind(body.name, body.target_amount, body.icon ?? "target", id, uid)
    .run();
  return c.json({ success: true });
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM earmarks WHERE goal_id=? AND user_id=?").bind(
      id,
      uid
    ),
    c.env.DB.prepare("DELETE FROM goals WHERE id=? AND user_id=?").bind(id, uid),
  ]);
  return c.json({ success: true });
});

app.post("/:id/allocate", async (c: AppContext) => {
  const uid = c.get("userId");
  const goalId = c.req.param("id");
  const body = await c.req.json();
  if (!body.amount || body.amount <= 0)
    return c.json({ error: "Amount must be positive" }, 400);
  const res = await c.env.DB.prepare(
    "INSERT INTO earmarks (user_id, goal_id, source_type, source_id, amount) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      uid,
      goalId,
      body.source_type ?? "wallet",
      body.source_id,
      body.amount
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

export default app;
