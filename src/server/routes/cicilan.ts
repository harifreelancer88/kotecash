import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { amortizationSchedule, accountBalance, type Movement } from "../formulas";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function enrich(c: AppContext, uid: number, row: any) {
  const mv = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id=?"
  ).bind(uid).all<Movement>();
  const sisa = accountBalance('cicilan', row.id, row.total_utang, mv.results);
  const monthsLeft = row.monthly_payment > 0 ? Math.ceil(sisa / row.monthly_payment) : 0;
  const pctPaid = row.total_utang > 0 ? (row.total_utang - sisa) / row.total_utang : 0;
  return { ...row, sisa, monthsLeft, pctPaid };
}

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT * FROM cicilan WHERE user_id = ? ORDER BY id"
  )
    .bind(uid)
    .all();
  const out = [];
  for (const r of res.results) out.push(await enrich(c, uid, r));
  return c.json(out);
});

app.get("/:id/schedule", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT * FROM cicilan WHERE id=? AND user_id=?"
  )
    .bind(id, uid)
    .first<any>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const e = await enrich(c, uid, row);
  return c.json(
    amortizationSchedule(e.sisa, row.bunga_persen, row.monthly_payment, e.monthsLeft)
  );
});

app.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  if (!body.monthly_payment || body.monthly_payment <= 0)
    return c.json({ error: "Positive monthly payment required" }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO cicilan (user_id, name, total_utang, monthly_payment, tenor_bulan, bunga_persen, start_date, due_date, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      uid,
      body.name,
      body.total_utang,
      body.monthly_payment,
      body.tenor_bulan ?? null,
      body.bunga_persen ?? 0,
      body.start_date,
      body.due_date,
      "active",
      body.notes ?? null
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE cicilan SET name=?, total_utang=?, monthly_payment=?, bunga_persen=?, status=? WHERE id=? AND user_id=?"
  )
    .bind(
      body.name,
      body.total_utang,
      body.monthly_payment,
      body.bunga_persen ?? 0,
      body.status ?? "active",
      id,
      uid
    )
    .run();
  return c.json({ success: true });
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const row = await enrich(
    c,
    uid,
    await c.env.DB
      .prepare("SELECT * FROM cicilan WHERE id=? AND user_id=?")
      .bind(id, uid)
      .first<any>()
  );
  if (row.sisa > 0)
    return c.json({ error: "Cannot delete active cicilan" }, 400);
  await c.env.DB.prepare("DELETE FROM cicilan WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true });
});

app.post("/:id/pay", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  if (!body.amount || body.amount <= 0) return c.json({ error: "Amount must be positive" }, 400);
  const srcKind = body.src_kind ?? "wallet";
  const srcId = body.src_id ?? body.wallet_id;
  const res = await c.env.DB.prepare(
    `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'cicilan', ?)`
  ).bind(uid, body.date, body.amount, body.description ?? null, body.category_id ?? null,
         srcKind, srcId, id).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

export default app;
