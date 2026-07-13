import { calculateHolding } from './formulas';
import { parseDecimal } from './decimal';

type DB = D1Database;
export type AccountValuation = { account_id:number; account_name?:string; account_type?:string; include_in_net_worth:boolean; is_active:boolean; valuation_mode:string; value:number; holdings_value:number; manual_snapshot_value:number; valuation_source:string; valuation_complete:boolean; latest_valuation_date:string|null; warnings:string[]; holding_count:number };
export type WealthAggregation = { total:number; holdings_value:number; manual_snapshot_value:number; account_count:number; holding_count:number; excluded_value:number; valuation_complete:boolean; warnings:string[]; assetBreakdown:Record<string,number>; accounts:AccountValuation[] };

const emptyBreakdown = () => ({ stocks:0, mutual_funds:0, etfs:0, retirement:0, fixed_income:0, manual_portfolios:0, other_investments:0 });
const retirement = new Set(['epf','nps','ppf','ssy','retirement']);
const fixed = new Set(['bond','fixed_income']);
function bucket(assetType?:string|null, accountType?:string|null, manual=false) {
  if (manual) return 'manual_portfolios';
  if (assetType === 'stock') return 'stocks';
  if (assetType === 'mutual_fund') return 'mutual_funds';
  if (assetType === 'etf') return 'etfs';
  if (retirement.has(assetType || '') || retirement.has(accountType || '')) return 'retirement';
  if (fixed.has(assetType || '') || fixed.has(accountType || '')) return 'fixed_income';
  return 'other_investments';
}
function isZero(q?:string|null){ return !q || parseDecimal(q,{allowZero:true})===0n; }
function latestSnapshot(rows:any[], id:number, asOf:string){
  return rows.filter(r=>r.entity_kind==='portfolio'&&r.entity_id===id&&String(r.recorded_at).slice(0,10)<=asOf).sort((a,b)=>String(b.recorded_at).localeCompare(String(a.recorded_at)))[0] || null;
}

export async function getWealthAccountValuations(db: DB, userId:number, asOf:string): Promise<{accounts:AccountValuation[]; breakdown:Record<string,number>}> {
  const [accRes, txRes, priceRes, histRes] = await Promise.all([
    db.prepare(`SELECT id,name,value,account_type,is_active,include_in_net_worth,valuation_mode FROM portfolios WHERE user_id=?`).bind(userId).all<any>(),
    db.prepare(`SELECT t.*, a.asset_type, a.pricing_mode FROM investment_transactions t LEFT JOIN investment_assets a ON a.id=t.asset_id WHERE t.user_id=? AND t.trade_date<=? ORDER BY t.trade_date,t.id`).bind(userId, asOf).all<any>(),
    db.prepare(`SELECT pr.* FROM investment_prices pr WHERE pr.user_id=? AND pr.price_date<=? ORDER BY pr.price_date DESC, pr.id DESC`).bind(userId, asOf).all<any>(),
    db.prepare(`SELECT entity_kind,entity_id,amount,recorded_at FROM balance_history WHERE user_id=? AND entity_kind='portfolio' AND recorded_at<=?`).bind(userId, `${asOf} 23:59:59`).all<any>(),
  ]);
  const breakdown = emptyBreakdown();
  const txByAccount = new Map<number, any[]>();
  for (const t of txRes.results) txByAccount.set(t.account_id, [...(txByAccount.get(t.account_id)||[]), t]);
  const accounts:AccountValuation[] = [];
  for (const a of accRes.results) {
    const mode = a.valuation_mode || 'manual_snapshot';
    const warnings:string[]=[]; let holdingsValue=0, holdingCount=0, latest:string|null=null, complete=true;
    const accountTx = txByAccount.get(a.id) || [];
    const groups = new Map<number, any[]>();
    for (const t of accountTx.filter(t=>t.asset_id)) groups.set(t.asset_id, [...(groups.get(t.asset_id)||[]), t]);
    for (const txs of groups.values()) {
      const first=txs[0]; const prices=priceRes.results.filter((p:any)=>p.asset_id===first.asset_id);
      const h=calculateHolding(txs, prices, { asOf, assetType:first.asset_type, pricingMode:first.pricing_mode });
      if (isZero(h.quantity)) continue;
      holdingCount++;
      if (h.current_value == null) { complete=false; warnings.push(`missing_price:${first.asset_id}`); }
      else { holdingsValue += h.current_value; breakdown[bucket(first.asset_type, a.account_type)] += h.current_value; }
      if (h.stale_price) warnings.push(`stale_price:${first.asset_id}`);
      for (const w of h.warnings) if(!warnings.includes(w)) warnings.push(w);
      if (h.latest_price_date && (!latest || h.latest_price_date > latest)) latest = h.latest_price_date;
    }
    const snap = latestSnapshot(histRes.results, a.id, asOf);
    const manualValue = snap ? Math.round(Number(snap.amount||0)) : Math.round(Number(a.value||0));
    let value=0, source='none';
    if (mode === 'holdings') { value=holdingsValue; source='holdings'; if (!holdingCount) warnings.push('no_open_holdings'); }
    else if (mode === 'manual_snapshot') { value=manualValue; source=snap?'balance_history':'portfolio.value'; breakdown.manual_portfolios += value; latest = snap?.recorded_at?.slice(0,10) || latest; }
    else {
      if (holdingCount) { value=holdingsValue; source='hybrid_holdings_authoritative'; warnings.push('hybrid_manual_residual_unavailable_holdings_authoritative'); }
      else { value=manualValue; source=snap?'hybrid_manual_snapshot_fallback':'hybrid_portfolio_value_fallback'; breakdown.manual_portfolios += value; latest = snap?.recorded_at?.slice(0,10) || latest; warnings.push('hybrid_manual_snapshot_fallback_no_holdings'); }
    }
    accounts.push({account_id:a.id, account_name:a.name, account_type:a.account_type, include_in_net_worth:a.include_in_net_worth!==0, is_active:a.is_active!==0, valuation_mode:mode, value, holdings_value:holdingsValue, manual_snapshot_value:manualValue, valuation_source:source, valuation_complete:complete, latest_valuation_date:latest, warnings, holding_count:holdingCount});
  }
  return {accounts, breakdown};
}

export async function getWealthAggregation(db:DB, userId:number, asOf:string):Promise<WealthAggregation>{
  const {accounts, breakdown} = await getWealthAccountValuations(db,userId,asOf);
  const included=accounts.filter(a=>a.include_in_net_worth);
  const warnings = accounts.flatMap(a=>a.warnings.map(w=>`account:${a.account_id}:${w}`));
  return { total:included.reduce((s,a)=>s+a.value,0), holdings_value:included.reduce((s,a)=>s+a.holdings_value,0), manual_snapshot_value:included.reduce((s,a)=>s+(a.valuation_source.includes('manual')||a.valuation_source.includes('portfolio.value')?a.value:0),0), account_count:included.filter(a=>a.value!==0||a.holding_count>0).length, holding_count:included.reduce((s,a)=>s+a.holding_count,0), excluded_value:accounts.filter(a=>!a.include_in_net_worth).reduce((s,a)=>s+a.value,0), valuation_complete:included.every(a=>a.valuation_complete), warnings, assetBreakdown:breakdown, accounts };
}
