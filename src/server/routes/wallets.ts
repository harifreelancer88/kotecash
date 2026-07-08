import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { accountBalance, type Movement, type Earmark } from "../formulas";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const wallets = await c.env.DB.prepare(
    "SELECT * FROM wallets WHERE user_id = ? ORDER BY id"
  ).bind(uid).all<{ id: number; initial_balance: number }>();

  const mvRes = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date, category_id FROM movements WHERE user_id = ?"
  ).bind(uid).all<Movement>();

  const out = [];
  for (const w of wallets.results) {
    const earmarks = await c.env.DB.prepare(
      "SELECT goal_id, source_type, source_id, amount FROM earmarks WHERE user_id = ? AND source_type='wallet' AND source_id=?"
    ).bind(uid, w.id).all<Earmark>();

    const balance = accountBalance('wallet', w.id, w.initial_balance, mvRes.results);
    const earmarked = earmarks.results.reduce((s, e) => s + e.amount, 0);
    const activity = await c.env.DB.prepare(
      `SELECT * FROM movements WHERE user_id=? AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?))
       ORDER BY date DESC, id DESC LIMIT 8`
    ).bind(uid, w.id, w.id).all();

    out.push({ ...w, balance, earmarked, free: balance - earmarked, activity: activity.results });
  }
  return c.json(out);
});

app.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  if (!body.name) return c.json({ error: "Name required" }, 400);
  const res = await c.env.DB.prepare(
    "INSERT INTO wallets (user_id, name, type, account_number, initial_balance) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      uid,
      body.name,
      body.type ?? "bank",
      body.account_number ?? null,
      body.initial_balance ?? 0
    )
    .run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE wallets SET name=?, account_number=? WHERE id=? AND user_id=?"
  )
    .bind(body.name, body.account_number ?? null, id, uid)
    .run();
  return c.json({ success: true });
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM movements WHERE user_id=? AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?))"
    ).bind(uid, id, id),
    c.env.DB.prepare(
      "DELETE FROM earmarks WHERE user_id=? AND source_type='wallet' AND source_id=?"
    ).bind(uid, id),
    c.env.DB.prepare("DELETE FROM wallets WHERE id=? AND user_id=?").bind(id, uid),
  ]);
  return c.json({ success: true });
});

async function walletFreeFor(c: AppContext, uid: number, walletId: number): Promise<number> {
  const w = await c.env.DB.prepare(
    "SELECT initial_balance FROM wallets WHERE id=? AND user_id=?"
  ).bind(walletId, uid).first<{ initial_balance: number }>();
  if (!w) return 0;
  const mv = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id=?"
  ).bind(uid).all<Movement>();
  const earmarks = await c.env.DB.prepare(
    "SELECT amount FROM earmarks WHERE user_id=? AND source_type='wallet' AND source_id=?"
  ).bind(uid, walletId).all<{ amount: number }>();
  const balance = accountBalance('wallet', walletId, w.initial_balance, mv.results);
  const earmarked = earmarks.results.reduce((s, e) => s + e.amount, 0);
  return balance - earmarked;
}

app.post("/:id/income", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  if (!body.amount || body.amount <= 0) return c.json({ error: "Amount must be positive" }, 400);
  const res = await c.env.DB.prepare(
    `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, 'wallet', ?)`
  ).bind(uid, body.date, body.amount, body.description ?? null, body.category_id ?? null, id).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.post("/:id/expense", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  if (!body.amount || body.amount <= 0) return c.json({ error: "Amount must be positive" }, 400);

  const free = await walletFreeFor(c, uid, id);
  let warning: object | null = null;
  if (body.amount > free) {
    const goals = await c.env.DB.prepare(
      `SELECT DISTINCT g.name FROM earmarks e JOIN goals g ON g.id = e.goal_id
       WHERE e.user_id=? AND e.source_type='wallet' AND e.source_id=?`
    ).bind(uid, id).all<{ name: string }>();
    warning = { type: "earmark_overspend", amount: body.amount, free, into: body.amount - free,
                impactedGoals: goals.results.map((g) => g.name) };
  }
  const res = await c.env.DB.prepare(
    `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
     VALUES (?, ?, ?, ?, ?, 'wallet', ?, NULL, NULL)`
  ).bind(uid, body.date, body.amount, body.description ?? null, body.category_id ?? null, id).run();
  return c.json({ id: res.meta.last_row_id, warning }, 201);
});

app.post("/transfer", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  if (!body.amount || body.amount <= 0) return c.json({ error: "Amount must be positive" }, 400);
  const srcKind = body.src_kind ?? "wallet";
  const dstKind = body.dst_kind ?? "wallet";
  const srcId = body.src_id ?? body.from_wallet_id;
  const dstId = body.dst_id ?? body.to_wallet_id;
  if (srcKind === dstKind && srcId === dstId)
    return c.json({ error: "Cannot transfer to same account" }, 400);
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  await c.env.DB.prepare(
    `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).bind(uid, date, body.amount, body.notes ?? null, srcKind, srcId, dstKind, dstId).run();
  return c.json({ success: true }, 201);
});

export default app;
