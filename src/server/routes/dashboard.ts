import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { currentMonth } from "../types";
import { getWealthAggregation } from "../wealth/valuation";
import { liabilityTotals, dueStatus } from "../wealth/liabilities";
import { calculateGoalProgress } from "../wealth/goals";
import {
  savingsRate,
  dtiRatio,
  accountBalance,
  pnl,
  type Movement,
  type Earmark,
} from "../formulas";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function savingsTier(sr: number): Promise<[string, string, string]> {
  if (sr >= 0.3) return ["Outstanding", "green", "award"];
  if (sr >= 0.2) return ["Excellent", "blue", "star"];
  if (sr >= 0.1) return ["Good", "amber", "thumbs-up"];
  return ["Needs Improvement", "red", "alert-triangle"];
}

async function dtiTier(dti: number): Promise<[string, string]> {
  if (dti < 0.3) return ["Healthy", "green"];
  if (dti < 0.5) return ["High", "amber"];
  return ["Critical", "red"];
}

app.get("/dashboard", async (c: AppContext) => {
  const uid = c.get("userId");
  const month = c.req.query("month") || currentMonth();

  // Lazy recurring sweep: materialize due templates before computing the month.
  try {
    await c.env.DB.prepare(
      `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id, recurring_id)
       SELECT t.user_id, t.next_run, t.amount, t.description, t.category_id, t.src_kind, t.src_id, t.dst_kind, t.dst_id, t.id
       FROM recurring_templates t
       WHERE t.user_id=? AND t.active=1 AND t.next_run <= date('now')
         AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.recurring_id=t.id AND m.date=t.next_run)`
    ).bind(uid).run();
    const due = await c.env.DB.prepare(
      "SELECT id, next_run, frequency, day_of_month, month_of_year, weekday FROM recurring_templates WHERE user_id=? AND active=1 AND next_run <= date('now')"
    ).bind(uid).all<any>();
    const { advanceNextRun } = await import("./recurring");
    for (const t of due.results) {
      const next = advanceNextRun({ frequency: t.frequency, day_of_month: t.day_of_month, month_of_year: t.month_of_year, weekday: t.weekday }, t.next_run);
      await c.env.DB.prepare("UPDATE recurring_templates SET next_run=? WHERE id=?").bind(next, t.id).run();
    }
  } catch (e) { /* sweep is best-effort; never block the dashboard */ }

  const asOf = `${month}-31`;
  const [wallets, cc, deposits, wealth, cicilan, mvRes, earmarks, phase11Liabilities] = await Promise.all([
    c.env.DB.prepare("SELECT id, initial_balance FROM wallets WHERE user_id = ?").bind(uid)
      .all<{ id: number; initial_balance: number }>(),
    c.env.DB.prepare("SELECT id, balance FROM credit_cards WHERE user_id = ?").bind(uid)
      .all<{ id: number; balance: number }>(),
    c.env.DB.prepare("SELECT id, amount FROM deposits WHERE user_id = ? AND status = 'active'").bind(uid)
      .all<{ id: number; amount: number }>(),
    getWealthAggregation(c.env.DB, uid, asOf),
    c.env.DB.prepare("SELECT id, total_utang, monthly_payment FROM cicilan WHERE user_id = ? AND status = 'active'")
      .bind(uid).all<{ id: number; total_utang: number; monthly_payment: number }>(),
    c.env.DB.prepare(
      "SELECT src_kind, src_id, dst_kind, dst_id, amount, date, category_id FROM movements WHERE user_id = ?"
    ).bind(uid).all<Movement>(),
    c.env.DB.prepare("SELECT source_type, source_id, goal_id, amount FROM earmarks WHERE user_id = ?")
      .bind(uid).all<Earmark>(),
    liabilityTotals(c.env.DB, uid, asOf),
  ]);

  const mv = mvRes.results;

  const totalLiquid = wallets.results.reduce(
    (s, w) => s + accountBalance('wallet', w.id, w.initial_balance, mv), 0);

  const totalCC = cc.results.reduce(
    (s, c2) => s + accountBalance('credit_card', c2.id, c2.balance, mv), 0);

  const totalCicilanSisa = cicilan.results.reduce(
    (s, ci) => s + accountBalance('cicilan', ci.id, ci.total_utang, mv), 0);
  const totalMonthlyDebt = cicilan.results.reduce((s, x) => s + x.monthly_payment, 0);

  const totalDeposits = deposits.results.reduce(
    (s, d) => s + accountBalance('deposit', d.id, d.amount, mv), 0);
  const totalPortfolios = wealth.total;
  const totalAssets = totalLiquid + totalDeposits + wealth.total;
  const totalLiabilities = totalCC + totalCicilanSisa + phase11Liabilities.total;
  const netWorth = totalAssets - totalLiabilities;
  const upcomingEmi = phase11Liabilities.items.filter((l:any)=>l.next_due_date && l.next_due_date >= new Date().toISOString().slice(0,10)).sort((a:any,b:any)=>String(a.next_due_date).localeCompare(String(b.next_due_date)))[0] || null;
  const overdueAmount = phase11Liabilities.items.filter((l:any)=>dueStatus(l.next_due_date || l.due_date)==="overdue").reduce((s:number,l:any)=>s + (l.emi_amount || l.minimum_due || l.valuation.outstanding),0);
  const highestOutstandingLiability = phase11Liabilities.items.reduce((a:any,b:any)=>!a || b.valuation.outstanding > a.valuation.outstanding ? b : a, null);

  const totalEarmarked = earmarks.results.reduce((s, e) => s + e.amount, 0);
  const walletEarmarked = earmarks.results
    .filter((e) => e.source_type === "wallet")
    .reduce((s, e) => s + e.amount, 0);
  const totalFree = totalLiquid - walletEarmarked;

  const { income, expense } = pnl(mv, month);
  const sisa = income - expense;
  const sr = savingsRate(income, expense);
  const dti = dtiRatio(income, totalMonthlyDebt);
  let goalsSummary:any = null;
  try {
    const goals = (await c.env.DB.prepare("SELECT * FROM financial_goals WHERE user_id=? AND status='active' ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,target_date,id LIMIT 3").bind(uid).all<any>()).results;
    const priority = [];
    let highPriorityWarning = false;
    for (const g of goals) { const p = await calculateGoalProgress(c.env.DB, uid, g, asOf); priority.push({ id:g.id, name:g.name, priority:g.priority, target_date:g.target_date, progress_percent:p.progress_percent, remaining_amount:p.remaining_amount, status:p.status }); if(g.priority==='high' && ['behind','slightly_behind'].includes(p.status)) highPriorityWarning = true; }
    goalsSummary = { top_priority_goals: priority, next_target_date: priority.map((g:any)=>g.target_date).filter(Boolean).sort()[0] || null, high_priority_warning: highPriorityWarning };
  } catch { goalsSummary = null; }

  return c.json({
    period: month,
    income,
    expense,
    sisa,
    totalLiquid,
    totalFree,
    totalEarmarked,
    totalCC,
    totalDeposits,
    totalPortfolios,
    totalAssets,
    wealthInvestmentValue: wealth.total,
    wealthHoldingsValue: wealth.holdings_value,
    wealthManualSnapshotValue: wealth.manual_snapshot_value,
    wealthValuationComplete: wealth.valuation_complete,
    wealthWarnings: wealth.warnings,
    excludedWealthInvestmentValue: wealth.excluded_value,
    assetBreakdown: { wallets: totalLiquid, deposits: totalDeposits, ...wealth.assetBreakdown },
    totalCicilanSisa,
    totalLiabilities,
    phase11LiabilitiesTotal: phase11Liabilities.total,
    monthlyDebtPayments: totalMonthlyDebt + phase11Liabilities.items.reduce((s:any,l:any)=>s+(l.emi_amount||l.minimum_due||0),0),
    upcomingEmi,
    overdueAmount,
    highestOutstandingLiability,
    debtToAssetsRatio: totalAssets ? totalLiabilities / totalAssets : null,
    netWorthAfterLiabilities: netWorth,
    liabilityBreakdown: phase11Liabilities.breakdown,
    netWorth,
    savingsRate: sr,
    savingsTier: await savingsTier(sr),
    dti,
    dtiTier: await dtiTier(dti),
    goalsSummary,
  });
});

export default app;
