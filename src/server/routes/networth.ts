import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";
import { currentMonth } from "../types";
import { getWealthAggregation } from "../wealth/valuation";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const MONTHS = 6;
function monthOffset(yyyymm: string, offset: number): string { const [y,m]=yyyymm.split('-').map(Number); return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7); }
function monthEnd(month:string){ return `${month}-31`; }

type Move = {src_kind:string|null;src_id:number|null;dst_kind:string|null;dst_id:number|null;amount:number;date:string};
async function reconstructMonth(db:D1Database, uid:number, month:string){
  const me=monthEnd(month);
  const [wallets,mvRows,cicilan,depositRows,ccRows,wealth] = await Promise.all([
    db.prepare("SELECT id, initial_balance FROM wallets WHERE user_id = ?").bind(uid).all<any>(),
    db.prepare("SELECT src_kind, src_id, dst_kind, dst_id, amount, date FROM movements WHERE user_id = ?").bind(uid).all<Move>(),
    db.prepare("SELECT id, total_utang, start_date FROM cicilan WHERE user_id = ? AND status = 'active'").bind(uid).all<any>(),
    db.prepare("SELECT id, amount, start_date FROM deposits WHERE user_id = ?").bind(uid).all<any>(),
    db.prepare("SELECT id, balance FROM credit_cards WHERE user_id = ?").bind(uid).all<any>(),
    getWealthAggregation(db, uid, me),
  ]);
  const mv=mvRows.results;
  const walletAssets=wallets.results.reduce((s,w)=>s+mv.reduce((b,m)=>m.date>me?b:b+(m.dst_kind==='wallet'&&m.dst_id===w.id?m.amount:0)-(m.src_kind==='wallet'&&m.src_id===w.id?m.amount:0), w.initial_balance),0);
  const depositAssets=depositRows.results.reduce((s,d)=>{ if(d.start_date>me)return s; return s+mv.reduce((b,m)=>m.date>me?b:b+(m.dst_kind==='deposit'&&m.dst_id===d.id?m.amount:0)-(m.src_kind==='deposit'&&m.src_id===d.id?m.amount:0), d.amount); },0);
  const cicilanLiab=cicilan.results.reduce((s,ci)=>{ if(ci.start_date>me)return s; const paid=mv.filter(m=>m.date<=me&&m.dst_kind==='cicilan'&&m.dst_id===ci.id).reduce((x,m)=>x+m.amount,0); return s+Math.max(ci.total_utang-paid,0); },0);
  const ccLiab=ccRows.results.reduce((s,cc)=>s+Math.max(mv.reduce((b,m)=>m.date>me?b:b+(m.src_kind==='credit_card'&&m.src_id===cc.id?m.amount:0)-(m.dst_kind==='credit_card'&&m.dst_id===cc.id?m.amount:0), cc.balance),0),0);
  const assetBreakdown={wallets:walletAssets,deposits:depositAssets,...wealth.assetBreakdown};
  const liabilityBreakdown={credit_cards:ccLiab,cicilan:cicilanLiab};
  const assets=walletAssets+depositAssets+wealth.total; const liabilities=ccLiab+cicilanLiab;
  return { month, assets, liabilities, netWorth:assets-liabilities, assetBreakdown, liabilityBreakdown, wealthInvestmentValue:wealth.total, wealthHoldingsValue:wealth.holdings_value, wealthManualSnapshotValue:wealth.manual_snapshot_value, valuation_complete:wealth.valuation_complete, warnings:wealth.warnings };
}

app.get("/", async (c: AppContext) => {
  const uid=c.get("userId"); const thisMonth=currentMonth(); const months:string[]=[]; for(let i=MONTHS-1;i>=0;i--) months.push(monthOffset(thisMonth,-i));
  const snapshots=await Promise.all(months.map(m=>reconstructMonth(c.env.DB,uid,m)));
  const last=snapshots[snapshots.length-1]; const prev=snapshots[snapshots.length-2]??last; const delta=last.netWorth-prev.netWorth;
  return c.json({ snapshots, current:last, delta, warnings:[...new Set(snapshots.flatMap(s=>s.warnings))] });
});

app.post("/snapshot", async (c: AppContext) => {
  const uid=c.get("userId"); const body=await c.req.json(); const month=body.month||currentMonth(); const force=body.force===true; const source=body.source||'manual';
  const existing=await c.env.DB.prepare("SELECT locked FROM net_worth_snapshots WHERE user_id=? AND month=?").bind(uid,month).first<any>();
  if(existing?.locked && !force) return c.json({ error:"Snapshot is locked; pass force=true to update manually" },409);
  const auto=body.assets==null||body.liabilities==null||body.net_worth==null ? await reconstructMonth(c.env.DB,uid,month) : null;
  const assets=Math.round(body.assets ?? auto!.assets), liabilities=Math.round(body.liabilities ?? auto!.liabilities), net=Math.round(body.net_worth ?? auto!.netWorth);
  const breakdown=body.breakdown_json ?? JSON.stringify(auto ? {assets:auto.assetBreakdown, liabilities:auto.liabilityBreakdown} : (body.breakdown||{}));
  const warnings=body.warnings_json ?? JSON.stringify(auto?.warnings ?? body.warnings ?? []);
  await c.env.DB.prepare(`INSERT INTO net_worth_snapshots (user_id, month, assets, liabilities, net_worth, breakdown_json, source, locked, calculated_at, warnings_json, valuation_complete, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)
    ON CONFLICT(user_id, month) DO UPDATE SET assets=excluded.assets, liabilities=excluded.liabilities, net_worth=excluded.net_worth, breakdown_json=excluded.breakdown_json, source=excluded.source, locked=excluded.locked, calculated_at=excluded.calculated_at, warnings_json=excluded.warnings_json, valuation_complete=excluded.valuation_complete, notes=excluded.notes`)
    .bind(uid,month,assets,liabilities,net,breakdown,source,body.locked?1:0,warnings,auto?.valuation_complete===false?0:1,body.notes??null).run();
  return c.json({ success:true, month, assets, liabilities, net_worth:net },201);
});

app.post("/recalculate", async (c:AppContext)=>{
  const uid=c.get('userId'); const body=await c.req.json(); const from=body.from||monthOffset(currentMonth(),-(MONTHS-1)); const to=body.to||currentMonth();
  const months:string[]=[]; for(let m=from;m<=to;m=monthOffset(m,1)){ if(body.include_current_month===false && m===currentMonth()) break; months.push(m); if(months.length>240) break; }
  let recalculated=0,created=0,skipped_locked:string[]=[]; const warnings:string[]=[];
  for(const m of months){ const ex=await c.env.DB.prepare('SELECT id,locked FROM net_worth_snapshots WHERE user_id=? AND month=?').bind(uid,m).first<any>(); if(ex?.locked){skipped_locked.push(m); continue;} const s=await reconstructMonth(c.env.DB,uid,m); warnings.push(...s.warnings); const br=JSON.stringify({assets:s.assetBreakdown,liabilities:s.liabilityBreakdown}); const wj=JSON.stringify(s.warnings); await c.env.DB.prepare(`INSERT INTO net_worth_snapshots (user_id,month,assets,liabilities,net_worth,breakdown_json,source,calculated_at,warnings_json,valuation_complete) VALUES (?,?,?,?,?,?, 'auto', datetime('now'), ?, ?) ON CONFLICT(user_id,month) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,net_worth=excluded.net_worth,breakdown_json=excluded.breakdown_json,source='auto',calculated_at=excluded.calculated_at,warnings_json=excluded.warnings_json,valuation_complete=excluded.valuation_complete`).bind(uid,m,s.assets,s.liabilities,s.netWorth,br,wj,s.valuation_complete?1:0).run(); ex?recalculated++:created++; }
  return c.json({recalculated,created,skipped_locked,warnings:[...new Set(warnings)]});
});
export default app;
