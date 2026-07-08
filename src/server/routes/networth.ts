import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { currentMonth } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const MONTHS = 6;

// "2026-06" → month shifted by `offset` months (0 = current month), as "YYYY-MM"
function monthOffset(yyyymm: string, offset: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}

type HistRow = { entity_kind: string; entity_id: number; amount: number; recorded_at: string };

// Latest recorded amount for (kind, id) on or before `cutoff` ("YYYY-MM-DD").
// Carry the baseline back: if no row <= cutoff, use the earliest row.
function asOf(rows: HistRow[], kind: string, id: number, cutoff: string): number {
  const ours = rows.filter((r) => r.entity_kind === kind && r.entity_id === id);
  if (!ours.length) return 0;
  ours.sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1));
  let pick = ours[0];
  for (const r of ours) {
    if (r.recorded_at.slice(0, 10) <= cutoff) pick = r;
  }
  return pick.amount;
}

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const thisMonth = currentMonth();
  const months: string[] = [];
  for (let i = MONTHS - 1; i >= 0; i--) months.push(monthOffset(thisMonth, -i));
  const monthEnds = months.map((m) => `${m}-31`);

  const [wallets, mvRows, cicilan, depositRows, portfolioRows, ccRows, histRows] = await Promise.all([
    c.env.DB.prepare("SELECT id, initial_balance FROM wallets WHERE user_id = ?").bind(uid)
      .all<{ id: number; initial_balance: number }>(),
    c.env.DB.prepare(
      "SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id = ?"
    ).bind(uid).all<{ src_kind: string; src_id: number; dst_kind: string; dst_id: number; amount: number; date: string }>(),
    c.env.DB.prepare("SELECT id, total_utang, start_date FROM cicilan WHERE user_id = ? AND status = 'active'")
      .bind(uid).all<{ id: number; total_utang: number; start_date: string }>(),
    c.env.DB.prepare("SELECT id, amount, start_date FROM deposits WHERE user_id = ?").bind(uid)
      .all<{ id: number; amount: number; start_date: string }>(),
    c.env.DB.prepare("SELECT id FROM portfolios WHERE user_id = ?").bind(uid).all<{ id: number }>(),
    c.env.DB.prepare("SELECT id, balance FROM credit_cards WHERE user_id = ?").bind(uid)
      .all<{ id: number; balance: number }>(),
    c.env.DB.prepare("SELECT entity_kind, entity_id, amount, recorded_at FROM balance_history WHERE user_id = ?")
      .bind(uid).all<HistRow>(),
  ]);

  const snapshots = monthEnds.map((me) => {
    // Wallet assets as-of me: initial_balance + Σ movements(dated) up to me.
    const walletAssets = wallets.results.reduce((s, w) => {
      let bal = w.initial_balance;
      for (const m of mvRows.results) {
        if (m.date > me) continue;
        if (m.dst_kind === "wallet" && m.dst_id === w.id) bal += m.amount;
        if (m.src_kind === "wallet" && m.src_id === w.id) bal -= m.amount;
      }
      return s + bal;
    }, 0);

    // Cicilan liabilities as-of me: total_utang − Σ payments(dst=cicilan) up to me (started).
    const cicilanLiab = cicilan.results.reduce((s, ci) => {
      if (ci.start_date > me) return s;
      let paid = 0;
      for (const m of mvRows.results) {
        if (m.dst_kind === "cicilan" && m.dst_id === ci.id && m.date <= me) paid += m.amount;
      }
      return s + Math.max(ci.total_utang - paid, 0);
    }, 0);

    // Deposit assets as-of me: amount + Σ in(dst) − Σ out(src) up to me (opened).
    const depositAssets = depositRows.results.reduce((s, d) => {
      if (d.start_date > me) return s;
      let bal = d.amount;
      for (const m of mvRows.results) {
        if (m.date > me) continue;
        if (m.dst_kind === "deposit" && m.dst_id === d.id) bal += m.amount;
        if (m.src_kind === "deposit" && m.src_id === d.id) bal -= m.amount;
      }
      return s + bal;
    }, 0);

    // Credit-card liabilities as-of me: balance + Σ charges(src) − Σ payments(dst) up to me.
    const ccLiab = ccRows.results.reduce((s, cc) => {
      let bal = cc.balance;
      for (const m of mvRows.results) {
        if (m.date > me) continue;
        if (m.src_kind === "credit_card" && m.src_id === cc.id) bal += m.amount;
        if (m.dst_kind === "credit_card" && m.dst_id === cc.id) bal -= m.amount;
      }
      return s + Math.max(bal, 0);
    }, 0);

    // Portfolios remain snapshot-based (market value, not cash movements).
    const portfolioAssets = portfolioRows.results.reduce(
      (s, p) => s + asOf(histRows.results, "portfolio", p.id, me), 0);

    const assets = walletAssets + portfolioAssets + depositAssets;
    const liabilities = cicilanLiab + ccLiab;
    return { month: me.slice(0, 7), assets, liabilities, netWorth: assets - liabilities };
  });

  const last = snapshots[snapshots.length - 1];
  const prev = snapshots[snapshots.length - 2] ?? last;
  const delta = last.netWorth - prev.netWorth;

  return c.json({ snapshots, delta });
});

app.post("/snapshot", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  const month = body.month || currentMonth();
  await c.env.DB.prepare(
    `INSERT INTO net_worth_snapshots (user_id, month, assets, liabilities, net_worth)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, month) DO UPDATE SET assets=excluded.assets, liabilities=excluded.liabilities, net_worth=excluded.net_worth`
  )
    .bind(uid, month, body.assets ?? 0, body.liabilities ?? 0, body.net_worth ?? 0)
    .run();
  return c.json({ success: true }, 201);
});

export default app;
