import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { currentMonth } from "../types";
import { alerts as budgetAlerts, calculateBudgetRows, categoryAnalytics, monthlyCashFlow, recurringCandidates } from "../budget-service";
import { getWealthAggregation } from "../wealth/valuation";
import { liabilityTotals, dueStatus } from "../wealth/liabilities";
import { calculateGoalProgress } from "../wealth/goals";
import { summary as incomeSummary, endOfMonth as incomeEndOfMonth } from "../income-service";
import { reconstructMonth } from "./networth";
import {
  savingsRate,
  dtiRatio,
  accountBalance,
  pnl,
  type Movement,
  type Earmark,
} from "../formulas";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4, warning: 2 };
const ownedKinds = new Set(["wallet", "deposit", "portfolio", "credit_card", "cicilan"]);
const finiteOrNull = (v: any) => Number.isFinite(Number(v)) ? Number(v) : null;
const finiteNum = (v: any) => Number.isFinite(Number(v)) ? Number(v) : 0;
const clean = (v: any): any => Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, val]) => [k, clean(val)])) : (typeof v === "number" && !Number.isFinite(v) ? null : v);
const pctChange = (cur: any, prev: any) => Number.isFinite(Number(cur)) && Number.isFinite(Number(prev)) && Number(prev) !== 0 ? ((Number(cur) - Number(prev)) / Number(prev)) * 100 : null;
const endOfMonth = (month: string) => { const [y,m]=month.split('-').map(Number); return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10); };
const addMonths = (month: string, delta: number) => { const d=new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5,7))-1+delta, 1)); return d.toISOString().slice(0,7); };
function attention(type:string,severity:string,title:string,explanation:string,opts:any={}){ return { type, severity: severity === 'warning' ? 'medium' : severity, title, explanation, amount: opts.amount ?? null, date: opts.date ?? null, destination_path: opts.destination_path || opts.path || '/', dismissible: opts.dismissible !== false, source_module: opts.source_module || 'dashboard', key: opts.key || `${type}:${opts.source_module||''}:${opts.date||''}:${opts.amount||''}` }; }
function health(status:string, explanation:string, metric:any, path:string){ return { status, explanation, supporting_metric: finiteOrNull(metric) ?? metric ?? null, destination_path: path }; }
async function maybe<T>(name:string, fn:()=>Promise<T>){ const start=Date.now(); try{return {name, data: await fn(), duration_ms: Date.now()-start};}catch(e:any){return {name, data:null as any, duration_ms: Date.now()-start, error:{message:e?.message||'Section unavailable'}};} }


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
  const canonicalNetWorth = await reconstructMonth(c.env.DB, uid, month);

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

  const asOf = canonicalNetWorth.snapshot_date;
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
  const totalPortfolios = canonicalNetWorth.wealthInvestmentValue;
  const totalAssets = canonicalNetWorth.assets;
  const totalLiabilities = canonicalNetWorth.liabilities;
  const netWorth = canonicalNetWorth.netWorth;
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
  const incomePlanning = await incomeSummary(c.env.DB, uid, `${month}-01`, incomeEndOfMonth(month)).catch(()=>null);

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
    wealthInvestmentValue: canonicalNetWorth.wealthInvestmentValue,
    wealthHoldingsValue: canonicalNetWorth.wealthHoldingsValue,
    wealthManualSnapshotValue: canonicalNetWorth.wealthManualSnapshotValue,
    wealthValuationComplete: canonicalNetWorth.valuation_complete,
    wealthWarnings: canonicalNetWorth.warnings,
    excludedWealthInvestmentValue: wealth.excluded_value,
    assetBreakdown: { wallets: canonicalNetWorth.cash_total, deposits: canonicalNetWorth.other_assets_total, ...wealth.assetBreakdown },
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
    incomePlanning,
  });
});


app.get("/dashboard/financial-overview", async (c: AppContext) => {
  const uid = c.get("userId");
  const month = c.req.query("month") || currentMonth();
  const canonicalNetWorth = await reconstructMonth(c.env.DB, uid, month);
  const asOf = c.req.query("as_of") || canonicalNetWorth.snapshot_date;
  const trendMonths = Math.min(Math.max(Number(c.req.query("trend_months") || 6), 1), 12);
  const errors: Record<string, any> = {};
  const section = async <T>(name:string, fn:()=>Promise<T>, fallback:any=null) => { const r=await maybe(name,fn); if(r.error) errors[name]=r.error; return r.data ?? fallback; };

  const [legacy, cash, prevCash, budgetRows, budgetAlertsRows, cats, recur, wealthOv, liabSum, liabRows, goalsRows, nwSnapshots, importsRows, pennyRows, movements, investmentTx, valuationRows] = await Promise.all([
    section('legacy_dashboard', async()=>{ const m = await c.env.DB.prepare('SELECT src_kind,src_id,dst_kind,dst_id,amount,date,category_id FROM movements WHERE user_id=?').bind(uid).all<Movement>(); return { mv:m.results }; }),
    section('cash_flow', ()=>monthlyCashFlow(c.env.DB, uid, month), {}),
    section('previous_cash_flow', ()=>monthlyCashFlow(c.env.DB, uid, addMonths(month,-1)), null),
    section('budgets', ()=>calculateBudgetRows(c.env.DB, uid, month), []),
    section('budget_alerts', ()=>budgetAlerts(c.env.DB, uid, month), []),
    section('cash_categories', ()=>categoryAnalytics(c.env.DB, uid, month), []),
    section('recurring', ()=>recurringCandidates(c.env.DB, uid), []),
    section('wealth', async()=>{ const res = await fetch(new URL(`/api/wealth/overview?as_of=${encodeURIComponent(asOf)}`, c.req.url), { headers: { cookie: c.req.header('cookie') || '', authorization: c.req.header('authorization') || '' } }); if(!res.ok) throw new Error('Wealth overview unavailable'); return res.json<any>(); }, null),
    section('liabilities', async()=>liabilityTotals(c.env.DB, uid, asOf), {total:0,items:[],breakdown:{}}),
    section('liabilities_rows', async()=> (await c.env.DB.prepare('SELECT * FROM liabilities WHERE user_id=? AND status IN (\'active\',\'open\') ORDER BY COALESCE(next_due_date,due_date),id LIMIT 50').bind(uid).all<any>()).results, []),
    section('goals', async()=> (await c.env.DB.prepare("SELECT * FROM financial_goals WHERE user_id=? ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, target_date, id LIMIT 50").bind(uid).all<any>()).results, []),
    section('net_worth_snapshots', async()=> (await c.env.DB.prepare('SELECT * FROM net_worth_snapshots WHERE user_id=? ORDER BY month DESC LIMIT ?').bind(uid, Math.max(trendMonths,12)).all<any>()).results, []),
    section('imports', async()=> (await c.env.DB.prepare('SELECT * FROM financial_import_batches WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(uid).all<any>()).results, []),
    section('pennywise', async()=> (await c.env.DB.prepare('SELECT * FROM pennywise_sync_records WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 50').bind(uid).all<any>()).results, []),
    section('recent_movements', async()=> (await c.env.DB.prepare('SELECT m.*, c.name category_name FROM movements m LEFT JOIN categories c ON c.id=m.category_id AND c.user_id=m.user_id WHERE m.user_id=? ORDER BY date DESC,id DESC LIMIT 10').bind(uid).all<any>()).results, []),
    section('recent_investments', async()=> (await c.env.DB.prepare('SELECT t.*, p.name account_name, a.name asset_name FROM investment_transactions t JOIN portfolios p ON p.id=t.account_id AND p.user_id=t.user_id LEFT JOIN investment_assets a ON a.id=t.asset_id AND a.user_id=t.user_id WHERE t.user_id=? ORDER BY trade_date DESC,t.id DESC LIMIT 10').bind(uid).all<any>()).results, []),
    section('valuations', async()=> (await c.env.DB.prepare('SELECT entity_kind, entity_id, as_of_date, value FROM balance_history WHERE user_id=? ORDER BY as_of_date DESC,id DESC LIMIT 10').bind(uid).all<any>()).results, []),
  ]);

  const mv = legacy?.mv || [];
  const [wallets, cc, deposits, cicilan, wealthAgg] = await Promise.all([
    section('wallets', async()=> (await c.env.DB.prepare('SELECT id,initial_balance,updated_at FROM wallets WHERE user_id=?').bind(uid).all<any>()).results, []),
    section('credit_cards', async()=> (await c.env.DB.prepare('SELECT id,balance,limit_amount,due_day,name FROM credit_cards WHERE user_id=?').bind(uid).all<any>()).results, []),
    section('deposits', async()=> (await c.env.DB.prepare("SELECT id,amount,maturity_date,bank,status,updated_at FROM deposits WHERE user_id=? AND status='active'").bind(uid).all<any>()).results, []),
    section('cicilan', async()=> (await c.env.DB.prepare("SELECT id,name,total_utang,monthly_payment,due_date,status FROM cicilan WHERE user_id=? AND status='active'").bind(uid).all<any>()).results, []),
    section('wealth_aggregation', ()=>getWealthAggregation(c.env.DB, uid, asOf), {total:0,valuation_complete:true,warnings:[],assetBreakdown:{}}),
  ]);
  const totalLiquid = wallets.reduce((s:any,w:any)=>s+accountBalance('wallet', w.id, w.initial_balance, mv),0);
  const totalCC = cc.reduce((s:any,x:any)=>s+accountBalance('credit_card', x.id, x.balance, mv),0);
  const totalDeposits = deposits.reduce((s:any,d:any)=>s+accountBalance('deposit', d.id, d.amount, mv),0);
  const totalCicilan = cicilan.reduce((s:any,x:any)=>s+accountBalance('cicilan', x.id, x.total_utang, mv),0);
  const assets = canonicalNetWorth.assets;
  const liabilitiesTotal = canonicalNetWorth.liabilities;
  const liveNetWorth = canonicalNetWorth.netWorth;
  const snaps = (nwSnapshots||[]).map((r:any)=>({month:r.snapshot_month||r.month, assets:r.assets_total??r.assets, liabilities:r.liabilities_total??r.liabilities, net_worth:r.net_worth, valuation_status:r.valuation_status, locked:!!r.locked, generated_at:r.generated_at||r.calculated_at||r.created_at})).filter((r:any)=>r.month).sort((a:any,b:any)=>a.month.localeCompare(b.month));
  const latestSnap = snaps.at(-1)||null, prevSnap = snaps.at(-2)||null, yStart = latestSnap ? snaps.find((s:any)=>s.month.slice(0,4)===latestSnap.month.slice(0,4)) : null;

  const topCat = (cats||[]).slice().sort((a:any,b:any)=>finiteNum(b.current_month_spending)-finiteNum(a.current_month_spending))[0]||null;
  const budgetTotal = budgetRows.reduce((s:any,b:any)=>s+finiteNum(b.effective_budget),0), budgetActual = budgetRows.reduce((s:any,b:any)=>s+finiteNum(b.actual_spending),0);
  const exceeded = budgetRows.filter((b:any)=>b.status==='over_budget'), approaching = budgetRows.filter((b:any)=>b.status==='approaching_limit');

  const goalDetails=[]; let active=0, completed=0, onTrack=0, behind=0, hiBehind=0, funded=0, remaining=0, monthlyReq=0;
  for(const g of goalsRows||[]){ const p=await calculateGoalProgress(c.env.DB, uid, g, asOf).catch(()=>null); if(g.status==='active') active++; if(g.status==='completed') completed++; if(p){ funded+=finiteNum(p.current_amount); remaining+=finiteNum(p.remaining_amount); monthlyReq+=finiteNum(p.required_monthly_contribution); if(['behind','slightly_behind'].includes(p.status)){ behind++; if(g.priority==='high') hiBehind++; } else if(g.status==='active') onTrack++; goalDetails.push({id:g.id,name:g.name,priority:g.priority,target_date:g.target_date,status:p.status,progress_percent:p.progress_percent,remaining_amount:p.remaining_amount,destination_path:'/?page=goals'}); }}

  const liabItems = liabSum.items || []; const nextLiab = liabItems.filter((l:any)=>l.next_due_date||l.due_date).sort((a:any,b:any)=>String(a.next_due_date||a.due_date).localeCompare(String(b.next_due_date||b.due_date)))[0]||null;
  const overdueAmount = liabItems.filter((l:any)=>dueStatus(l.next_due_date||l.due_date)==='overdue').reduce((s:number,l:any)=>s+finiteNum(l.emi_amount||l.minimum_due||l.valuation?.outstanding),0);
  const originalPrincipal = liabItems.reduce((s:number,l:any)=>s+finiteNum(l.original_principal),0); const repaid = liabItems.reduce((s:number,l:any)=>s+finiteNum(l.valuation?.principal_repaid),0);

  const items:any[]=[]; for(const a of budgetAlertsRows||[]) items.push(attention(a.alert_type, a.severity, a.title, a.explanation, {amount:a.current_value, date:a.generated_date, path:'/?page=budgets', source_module:'budget', key:a.alert_type+':' +(a.affected_category_id||a.affected_transaction_id||'month')}));
  if(overdueAmount>0) items.push(attention('overdue_liability','critical','Overdue liability payment','One or more liabilities are past due.',{amount:overdueAmount,path:'/?page=liabilities',source_module:'liabilities'}));
  if(hiBehind>0) items.push(attention('high_priority_goal_behind','high','High-priority goal behind','A high-priority goal is behind its target pace.',{path:'/?page=goals',source_module:'goals'}));
  for(const w of (wealthAgg.warnings||[]).slice(0,4)) items.push(attention(/missing/i.test(w)?'missing_price':'stale_wealth_valuation','medium','Wealth valuation needs review',String(w),{path:'/?page=wealth',source_module:'wealth',key:w}));
  const unresolved = importsRows.reduce((s:any,b:any)=>s+finiteNum(b.error_count)+finiteNum(b.row_count)-finiteNum(b.committed_count)-finiteNum(b.skipped_count),0); if(unresolved>0) items.push(attention('unresolved_import_rows','medium','Statement import review needed','Some import rows are unresolved or failed.',{amount:unresolved,path:'/?page=imports',source_module:'imports'}));
  const failedPw = pennyRows.filter((p:any)=>/failed|error|validation|mapping/.test(String(p.sync_status))).length; if(failedPw) items.push(attention('failed_pennywise_sync','medium','PennyWise sync needs review','Some PennyWise transactions need review.',{amount:failedPw,path:'/?page=pennywise',source_module:'pennywise'}));
  const dedup = new Map<string,any>(); for(const it of items) if(!dedup.has(it.key)) dedup.set(it.key,it); const attentionItems=[...dedup.values()].sort((a,b)=>sevRank[a.severity]-sevRank[b.severity] || String(a.date||'').localeCompare(String(b.date||''))).map(({key,...x})=>x);

  const horizon = new Date(Date.now()+30*86400000).toISOString().slice(0,10); const today = new Date().toISOString().slice(0,10); const upcoming:any[]=[];
  for(const l of liabItems){ const d=l.next_due_date||l.due_date; if(d&&d>=today&&d<=horizon) upcoming.push({type:l.liability_type==='credit_card'?'credit_card_due_date':'emi_due',date:d,title:l.name,amount:l.emi_amount||l.minimum_due||null,destination_path:'/?page=liabilities'}); }
  for(const cci of cc){ if(cci.due_day){ const d=`${month}-${String(cci.due_day).padStart(2,'0')}`; if(d>=today&&d<=horizon) upcoming.push({type:'credit_card_due_date',date:d,title:cci.name,amount:null,destination_path:'/?page=creditcard'}); }}
  for(const r of recur||[]) if(r.next_expected_date&&r.next_expected_date<=horizon) upcoming.push({type:'recurring_bill',date:r.next_expected_date,title:r.merchant,amount:r.typical_amount,destination_path:'/?page=budgets&budgetTab=recurring'});
  for(const g of goalDetails) if(g.target_date&&g.target_date>=today&&g.target_date<=horizon) upcoming.push({type:'goal_target_date',date:g.target_date,title:g.name,amount:g.remaining_amount,destination_path:'/?page=goals'});
  for(const d of deposits) if(d.maturity_date&&d.maturity_date>=today&&d.maturity_date<=horizon) upcoming.push({type:'fixed_deposit_maturity',date:d.maturity_date,title:d.bank||'Fixed deposit',amount:d.amount,destination_path:'/?page=assets'});

  const activity = [
    ...movements.map((m:any)=>({date_time:m.date,source_type:'Ledger movement',title:m.description||m.category_name||'Ledger movement',amount:m.amount,status:'posted',related_entity:m.category_name,destination_path:'/?page=ledger'})),
    ...investmentTx.map((t:any)=>({date_time:t.trade_date,source_type:'Wealth transaction',title:[t.transaction_type,t.asset_name].filter(Boolean).join(' '),amount:t.net_amount??t.gross_amount,status:'posted',related_entity:t.account_name,destination_path:'/?page=wealth'})),
    ...valuationRows.map((v:any)=>({date_time:v.as_of_date,source_type:'Valuation snapshot',title:`${v.entity_kind} valuation`,amount:v.value,status:'recorded',related_entity:v.entity_id,destination_path:'/?page=networth'})),
    ...importsRows.slice(0,5).map((b:any)=>({date_time:b.committed_at||b.created_at,source_type:'Import commit',title:b.source_filename,amount:b.committed_count,status:b.status,related_entity:b.import_type,destination_path:'/?page=imports'})),
    ...pennyRows.slice(0,5).map((p:any)=>({date_time:p.updated_at||p.created_at,source_type:'PennyWise sync',title:p.merchant||p.client_transaction_id,amount:p.amount,status:p.sync_status,related_entity:p.client_id,destination_path:'/?page=pennywise'})),
  ].filter(a=>a.date_time).sort((a,b)=>String(b.date_time).localeCompare(String(a.date_time))).slice(0,20);

  const response = {
    period: { month, as_of: asOf, currency: c.req.query('currency') || 'IDR', generated_at: new Date().toISOString() },
    net_worth: { current_live_net_worth: liveNetWorth, current_live_assets: assets, current_live_liabilities: liabilitiesTotal, latest_locked_snapshot_net_worth: latestSnap?.locked ? latestSnap.net_worth : null, previous_month_net_worth: prevSnap?.net_worth ?? null, month_on_month_change: latestSnap&&prevSnap?latestSnap.net_worth-prevSnap.net_worth:null, month_on_month_percentage: latestSnap&&prevSnap?pctChange(latestSnap.net_worth,prevSnap.net_worth):null, year_to_date_change: latestSnap&&yStart?latestSnap.net_worth-yStart.net_worth:null, year_to_date_percentage: latestSnap&&yStart?pctChange(latestSnap.net_worth,yStart.net_worth):null, valuation_status: canonicalNetWorth.valuation_status, latest_snapshot_month: latestSnap?.month ?? null, trend: snaps.slice(-trendMonths), reconciliation: { wallet_cash: canonicalNetWorth.cash_total, wealth_investments: canonicalNetWorth.wealthInvestmentValue, other_assets: canonicalNetWorth.other_assets_total, liabilities: canonicalNetWorth.liabilities, total: canonicalNetWorth.netWorth } },
    cash_flow: { income: cash.total_income ?? null, ordinary_expenses: cash.total_expenses ?? null, debt_payments: cash.debt_payments ?? null, investment_contributions: cash.investment_contributions ?? null, net_cash_flow: cash.net_cash_flow ?? null, savings_amount: cash.savings_amount ?? null, savings_rate: cash.savings_rate ?? null, projected_month_end_result: cash.projected_month_end_surplus_or_deficit ?? null, previous_month_comparison: prevCash?{income_change:(cash.total_income??0)-(prevCash.total_income??0),expense_change:(cash.total_expenses??0)-(prevCash.total_expenses??0),net_cash_flow_change:(cash.net_cash_flow??0)-(prevCash.net_cash_flow??0)}:null, top_spending_category: topCat?{category_id:topCat.category_id,name:topCat.category_name,amount:topCat.current_month_spending}:null, fixed_expenses: cash.fixed_expenses ?? null, variable_expenses: cash.variable_expenses ?? null, discretionary_expenses: cash.discretionary_expenses ?? null },
    wealth: { current_investment_value: wealthOv?.summary?.current_value ?? canonicalNetWorth.wealthInvestmentValue ?? null, market_holdings_value: wealthOv?.summary?.market_holdings_value ?? canonicalNetWorth.wealthHoldingsValue ?? null, other_investment_value: wealthOv?.summary?.other_investment_value ?? canonicalNetWorth.wealthManualSnapshotValue ?? null, total_invested: wealthOv?.summary?.total_invested ?? null, total_gain_loss: wealthOv?.summary?.total_gain ?? null, realised_gain: wealthOv?.summary?.realised_gain ?? null, unrealised_gain: wealthOv?.summary?.unrealised_gain ?? null, xirr: wealthOv?.summary?.xirr ?? null, valuation_completeness: wealthOv?.valuation_health ?? {status: canonicalNetWorth.valuation_complete?'complete':'partial'}, open_holdings: wealthOv?.summary?.open_holdings ?? null, top_holding: wealthOv?.largest_holdings?.[0] ?? null, top_gainer: wealthOv?.top_gainers?.[0] ?? null, top_loser: wealthOv?.top_losers?.[0] ?? null, investment_change_since_previous_month: latestSnap&&prevSnap?(latestSnap.assets??0)-(prevSnap.assets??0):null, asset_allocation_summary: wealthOv?.allocations?.asset_type ?? wealthAgg.assetBreakdown ?? null },
    liabilities: { total_outstanding: liabilitiesTotal, monthly_emi_commitment: liabItems.reduce((s:number,l:any)=>s+finiteNum(l.emi_amount||l.minimum_due),0)+cicilan.reduce((s:any,x:any)=>s+finiteNum(x.monthly_payment),0), upcoming_payment: nextLiab?{date:nextLiab.next_due_date||nextLiab.due_date,amount:nextLiab.emi_amount||nextLiab.minimum_due,name:nextLiab.name}:null, overdue_amount: overdueAmount, active_liabilities: liabItems.length+cicilan.length+cc.length, highest_interest_liability: liabItems.slice().sort((a:any,b:any)=>finiteNum(b.interest_rate)-finiteNum(a.interest_rate))[0]||null, credit_card_utilization_summary: cc.length?{cards:cc.length,total_balance:totalCC,total_limit:cc.reduce((s:any,x:any)=>s+finiteNum(x.limit_amount),0),utilization_percentage:cc.reduce((s:any,x:any)=>s+finiteNum(x.limit_amount),0)?totalCC/cc.reduce((s:any,x:any)=>s+finiteNum(x.limit_amount),0)*100:null}:null, debt_to_assets_ratio: assets?liabilitiesTotal/assets:null, payoff_progress: originalPrincipal?repaid/originalPrincipal*100:null },
    goals: { active_goals: active, completed_goals: completed, goals_on_track: onTrack, goals_behind: behind, high_priority_goals_behind: hiBehind, total_funded: funded, total_remaining: remaining, monthly_contribution_required: monthlyReq, next_target_date: goalDetails.map(g=>g.target_date).filter(Boolean).sort()[0]||null, top_three_priority_goals: goalDetails.slice(0,3), emergency_fund_coverage: null, debt_payoff_progress: originalPrincipal?repaid/originalPrincipal*100:null },
    budgets: { total_monthly_budget: budgetTotal, actual_spending: budgetActual, remaining_budget: budgetTotal-budgetActual, used_percentage: budgetTotal?budgetActual/budgetTotal*100:null, safe_to_spend_amount: budgetRows.reduce((s:any,b:any)=>s+finiteNum(b.daily_safe_to_spend),0), projected_result: budgetRows.reduce((s:any,b:any)=>s+finiteNum(b.effective_budget)-finiteNum(b.projected_month_end_spending),0), exceeded_categories: exceeded, approaching_limit_categories: approaching, monthly_savings_target: budgetRows.filter((b:any)=>b.budget_type==='savings_target').reduce((s:any,b:any)=>s+finiteNum(b.effective_budget),0), actual_savings: cash.savings_amount ?? null, difference: cash.savings_amount==null?null:cash.savings_amount-budgetRows.filter((b:any)=>b.budget_type==='savings_target').reduce((s:any,b:any)=>s+finiteNum(b.effective_budget),0) },
    alerts: { items: attentionItems, initial_items: attentionItems.slice(0,5), severity_order: ['critical','high','medium','low','info'] },
    upcoming: upcoming.sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(0,20),
    imports: { latest_batch: importsRows[0]||null, unresolved_rows: unresolved, failed_rows: importsRows.reduce((s:any,b:any)=>s+finiteNum(b.error_count),0), unreconciled_batches: importsRows.filter((b:any)=>['uploaded','previewed','validated','ready','needs_mapping'].includes(b.status)).length, rolled_back_batches: importsRows.filter((b:any)=>b.status==='rolled_back').length, latest_successful_import: importsRows.find((b:any)=>['committed','partially_committed'].includes(b.status))||null },
    pennywise: { last_sync: pennyRows[0]?.updated_at ?? null, pending_review_count: pennyRows.filter((p:any)=>/mapping|validation|possible_duplicate/.test(String(p.sync_status))).length, approved_and_ready_count: pennyRows.filter((p:any)=>p.sync_status==='approved').length, failed_sync_count: failedPw, duplicate_count: pennyRows.filter((p:any)=>/duplicate|already_synced/.test(String(p.sync_status))).length, connection_status: pennyRows.length?'connected':'not_configured' },
    recent_activity: activity,
    health: { net_worth_trend: health(latestSnap&&prevSnap ? (latestSnap.net_worth>=prevSnap.net_worth?'good':'watch') : 'unavailable', latestSnap&&prevSnap?'Based on latest locked snapshot trend.':'Net-worth history is unavailable.', latestSnap&&prevSnap?latestSnap.net_worth-prevSnap.net_worth:null, '/?page=networth'), savings_health: health(cash.savings_rate==null?'unavailable':cash.savings_rate>=0.1?'good':'watch','Deterministic savings-rate threshold for tracking only.',cash.savings_rate,'/?page=budgets'), debt_burden: health(assets?((liabilitiesTotal/assets)<0.5?'good':'attention'):'unavailable','Debt burden uses liabilities divided by assets.',assets?liabilitiesTotal/assets:null,'/?page=liabilities'), budget_health: health(exceeded.length?'attention':approaching.length?'watch':'good', exceeded.length?'Some budgets are exceeded.':approaching.length?'Some budgets are near limit.':'Budgets are within tracked limits.', exceeded.length||approaching.length,'/?page=budgets'), goal_progress: health(behind?'watch':'good', behind?'Some goals are behind target pace.':'Active goals are not behind based on stored targets.', behind, '/?page=goals'), investment_valuation_health: health(wealthAgg.valuation_complete?'good':'attention', wealthAgg.valuation_complete?'Investment valuations are complete.':'Some investment valuations need review.', wealthAgg.warnings?.length||0, '/?page=wealth'), data_freshness: health(Object.keys(errors).length?'watch':'good', Object.keys(errors).length?'One or more dashboard sections returned partial data.':'Dashboard sections loaded successfully.', Object.keys(errors).length, '/?page=imports') },
    section_errors: errors,
    meta: { partial: Object.keys(errors).length>0, response_size_limited: true, timing_note: 'Independent dashboard sections are loaded with Promise.all where safe; financial payloads are not logged.' }
  };
  return c.json(clean(response));
});

export default app;
