import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { ccUtilizationColor, accountBalance, portfolioValue, type Movement, type Snapshot } from "../formulas";

// Append a balance_history row. Append-only — never overwrites; drives the
// historical Net Worth trend for portfolios/deposits/credit_cards.
function recordBalance(env: any, uid: number, kind: string, entityId: number, amount: number) {
  return env.DB.prepare(
    "INSERT INTO balance_history (user_id, entity_kind, entity_id, amount) VALUES (?, ?, ?, ?)"
  )
    .bind(uid, kind, entityId, amount)
    .run();
}

// ---- Credit Cards ----
export const creditCards = new Hono<{ Bindings: Bindings; Variables: Variables }>();

creditCards.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT * FROM credit_cards WHERE user_id=? ORDER BY id"
  ).bind(uid).all<any>();
  const mv = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id=?"
  ).bind(uid).all<Movement>();
  const out = res.results.map((cc: any) => {
    const balance = accountBalance('credit_card', cc.id, cc.balance, mv.results);
    return {
      ...cc, balance,
      utilization: cc.limit_amount > 0 ? balance / cc.limit_amount : 0,
      color: ccUtilizationColor(balance, cc.limit_amount),
      available: cc.limit_amount - balance,
    };
  });
  return c.json(out);
});

creditCards.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const res = await c.env.DB.prepare(
    `INSERT INTO credit_cards (user_id, name, limit_amount, balance, statement_day, due_day, min_payment_pct, interest_rate, annual_fee)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).bind(uid, body.name, body.limit_amount, body.statement_day, body.due_day,
         body.min_payment_pct ?? 10, body.interest_rate ?? 0, body.annual_fee ?? 0).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

creditCards.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE credit_cards SET name=?, limit_amount=?, statement_day=?, due_day=?, min_payment_pct=?, interest_rate=?, annual_fee=?
     WHERE id=? AND user_id=?`
  ).bind(body.name, body.limit_amount, body.statement_day, body.due_day,
         body.min_payment_pct ?? 10, body.interest_rate ?? 0, body.annual_fee ?? 0, id, uid).run();
  return c.json({ success: true });
});

creditCards.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const cc = await c.env.DB.prepare(
    "SELECT balance FROM credit_cards WHERE id=? AND user_id=?"
  ).bind(id, uid).first<{ balance: number }>();
  if (!cc) return c.json({ error: "Not found" }, 404);
  const mv = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id=?"
  ).bind(uid).all<Movement>();
  const balance = accountBalance('credit_card', Number(id), cc.balance, mv.results);
  if (balance !== 0) return c.json({ error: "Cannot delete card with non-zero balance" }, 400);
  await c.env.DB.prepare("DELETE FROM credit_cards WHERE id=? AND user_id=?").bind(id, uid).run();
  return c.json({ success: true });
});

// ---- Deposits ----
export const deposits = new Hono<{ Bindings: Bindings; Variables: Variables }>();

deposits.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT * FROM deposits WHERE user_id=? ORDER BY id"
  ).bind(uid).all<any>();
  const mv = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id=?"
  ).bind(uid).all<Movement>();
  const out = res.results.map((d: any) => {
    const balance = accountBalance('deposit', d.id, d.amount, mv.results);
    const interestEarned = Math.round(d.amount * (d.rate / 100) * (d.tenor_months / 12));
    return {
      ...d, balance,
      interestEarned,
      maturityValue: d.amount + interestEarned,
      status: new Date(d.maturity_date) < new Date() ? "matured" : d.status,
    };
  });
  return c.json(out);
});

deposits.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const res = await c.env.DB.prepare(
    "INSERT INTO deposits (user_id, bank, amount, rate, tenor_months, start_date, maturity_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      uid,
      body.bank,
      body.amount,
      body.rate ?? 0,
      body.tenor_months,
      body.start_date,
      body.maturity_date,
      "active"
    )
    .run();
  await recordBalance(c.env, uid, "deposit", res.meta.last_row_id as number, body.amount);
  return c.json({ id: res.meta.last_row_id }, 201);
});

deposits.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.prepare(
    "UPDATE deposits SET amount=?, rate=?, tenor_months=? WHERE id=? AND user_id=?"
  )
    .bind(body.amount, body.rate ?? 0, body.tenor_months, id, uid)
    .run();
  await recordBalance(c.env, uid, "deposit", Number(id), body.amount);
  return c.json({ success: true });
});

deposits.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM deposits WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true });
});

deposits.post("/:id/withdraw", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const dep = await c.env.DB.prepare(
    "SELECT withdrawal_wallet_id FROM deposits WHERE id=? AND user_id=?"
  ).bind(id, uid).first<{ withdrawal_wallet_id: number | null }>();
  const dstWallet = body.wallet_id ?? dep?.withdrawal_wallet_id;
  if (!dstWallet) return c.json({ error: "No withdrawal wallet bound; pass wallet_id" }, 400);
  const amount = Number(body.amount);
  if (!amount || amount <= 0) return c.json({ error: "Amount must be positive" }, 400);
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
       VALUES (?, ?, ?, ?, NULL, 'deposit', ?, 'wallet', ?)`
    ).bind(uid, date, amount, body.description ?? "Deposit withdrawal", id, dstWallet),
    ...(body.interest ? [c.env.DB.prepare(
      `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'wallet', ?)`
    ).bind(uid, date, body.interest, "Deposit interest", dstWallet)] : []),
  ]);
  return c.json({ success: true }, 201);
});

// ---- Portfolios ----
export const portfolios = new Hono<{ Bindings: Bindings; Variables: Variables }>();

portfolios.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT * FROM portfolios WHERE user_id=? ORDER BY id"
  ).bind(uid).all<any>();
  const snaps = await c.env.DB.prepare(
    "SELECT entity_kind, entity_id, amount, recorded_at FROM balance_history WHERE user_id=? AND entity_kind='portfolio'"
  ).bind(uid).all<Snapshot>();
  const mv = await c.env.DB.prepare(
    "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id=?"
  ).bind(uid).all<Movement>();
  const out = res.results.map((p: any) => ({
    ...p,
    currentValue: portfolioValue(p.id, snaps.results, mv.results),
  }));
  return c.json(out);
});

portfolios.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const res = await c.env.DB.prepare(
    "INSERT INTO portfolios (user_id, name, value) VALUES (?, ?, ?)"
  )
    .bind(uid, body.name, body.value ?? 0)
    .run();
  await recordBalance(c.env, uid, "portfolio", res.meta.last_row_id as number, body.value ?? 0);
  return c.json({ id: res.meta.last_row_id }, 201);
});

portfolios.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE portfolios SET name=?, updated_at=datetime('now'), last_snapshot_at=datetime('now') WHERE id=? AND user_id=?"
    ).bind(body.name, id, uid),
    c.env.DB.prepare(
      "INSERT INTO balance_history (user_id, entity_kind, entity_id, amount) VALUES (?, 'portfolio', ?, ?)"
    ).bind(uid, Number(id), body.value),
  ]);
  return c.json({ success: true });
});

portfolios.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM portfolios WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true });
});

portfolios.post("/:id/trade", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  if (!body.amount || body.amount <= 0) return c.json({ error: "Amount must be positive" }, 400);
  const walletId = body.wallet_id;
  if (!walletId) return c.json({ error: "wallet_id required" }, 400);
  const isBuy = (body.direction ?? "buy") === "buy";
  const [srcKind, srcId, dstKind, dstId] = isBuy
    ? ["wallet", walletId, "portfolio", id]
    : ["portfolio", id, "wallet", walletId];
  await c.env.DB.prepare(
    `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).bind(uid, body.date ?? new Date().toISOString().slice(0, 10),
         body.amount, body.description ?? null, srcKind, srcId, dstKind, dstId).run();
  return c.json({ success: true }, 201);
});
