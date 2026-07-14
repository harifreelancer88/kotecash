import { calculateHolding } from './formulas';
import { parseDecimal } from './decimal';
import { annualEstimateValue, fixedDepositValue } from './fixed-deposit';

type DB = D1Database;
export type ValuationSource = 'holdings'|'manual_snapshot'|'account_snapshot'|'formula'|'hybrid_fallback'|'legacy_balance_history'|'legacy_portfolio_value'|'unavailable';
export type AccountValuation = { account_id:number; account_name?:string; account_type?:string; include_in_net_worth:boolean; is_active:boolean; valuation_mode:string; value:number; holdings_value:number; manual_snapshot_value:number; valuation_source:ValuationSource; valuation_date:string|null; source_record_id:number|null; valuation_status:string; valuation_message:string; valuation_complete:boolean; latest_valuation_date:string|null; warnings:string[]; holding_count:number; status?:string };
export type WealthAggregation = { total:number; holdings_value:number; manual_snapshot_value:number; account_count:number; holding_count:number; excluded_value:number; valuation_complete:boolean; warnings:string[]; assetBreakdown:Record<string,number>; accounts:AccountValuation[] };

const emptyBreakdown = () => ({ equity:0, mutual_funds:0, retirement:0, deposits:0, gold:0, bonds:0, crypto:0, other:0, stocks:0, fixed_income:0, manual_portfolios:0 });
const retirement = new Set(['epf','nps','ppf','ssy']);
function bucket(assetType?:string|null, accountType?:string|null) { const t=assetType||accountType||'other'; if(t==='stock')return 'equity'; if(t==='mutual_fund')return 'mutual_funds'; if(retirement.has(t))return 'retirement'; if(t==='fixed_deposit'||t==='cash_equivalent')return 'deposits'; if(t==='gold')return 'gold'; if(t==='bond')return 'bonds'; if(t==='crypto')return 'crypto'; return 'other'; }
function isZero(q?:string|null){ return !q || parseDecimal(q,{allowZero:true})===0n; }
function staleThreshold(type?:string|null, source?:string){ if(type==='stock'||type==='mutual_fund')return 7; if(type==='nps')return 45; if(type==='gold')return 30; if(['epf','ppf','ssy','fixed_deposit'].includes(type||''))return source==='formula'?Infinity:120; return Number((globalThis as any).process?.env?.WEALTH_MANUAL_VALUATION_STALE_DAYS || 90); }
function stale(date:string|null, asOf:string, type?:string|null, source?:string){ if(!date)return false; const th=staleThreshold(type,source); return Number.isFinite(th) && (Date.parse(asOf)-Date.parse(date))/86400000 > th; }
function latest(rows:any[], accountId:number, asOf:string, assetId?:number|null){ return rows.filter(r=>r.account_id===accountId && (assetId===undefined ? true : (r.asset_id??null)===(assetId??null)) && r.valuation_date<=asOf).sort((a,b)=>String(b.valuation_date).localeCompare(String(a.valuation_date))||b.id-a.id)[0] || null; }
function legacy(rows:any[], id:number, asOf:string){ return rows.filter(r=>r.entity_kind==='portfolio'&&r.entity_id===id&&String(r.recorded_at).slice(0,10)<=asOf).sort((a,b)=>String(b.recorded_at).localeCompare(String(a.recorded_at))||Number(b.id||0)-Number(a.id||0))[0] || null; }
function legacyValue(row:any, movements:any[], accountId:number){ if(!row) return null; const cutoff=String(row.recorded_at).slice(0,10); const out=movements.filter(m=>m.src_kind==='portfolio'&&m.src_id===accountId&&m.date>cutoff).reduce((s,m)=>s+Number(m.amount||0),0); return Math.round(Number(row.amount||0))-out; }
function labelDate(date:string|null){ return date || 'date unavailable'; }
function message(source:ValuationSource, date:string|null, warning=false){
  if(source==='holdings') return `Holdings · priced ${labelDate(date)}`;
  if(source==='manual_snapshot') return `Manual snapshot · ${labelDate(date)}`;
  if(source==='account_snapshot') return `Account snapshot · ${labelDate(date)}`;
  if(source==='formula') return `Formula estimate · ${labelDate(date)}`;
  if(source==='hybrid_fallback') return `Hybrid fallback · ${labelDate(date)}`;
  if(source==='legacy_balance_history') return warning ? 'This account is using a legacy balance value. Add a dated valuation snapshot to manage its history.' : `Legacy balance value · ${labelDate(date)}`;
  if(source==='legacy_portfolio_value') return warning ? 'This account is using a legacy portfolio value. Add a dated valuation snapshot to manage its history.' : `Legacy portfolio value · ${labelDate(date)}`;
  return 'Valuation unavailable';
}
export function valuationProvenanceLabel(v:{valuation_source?:string; valuation_date?:string|null; valuation_message?:string|null}){ return v.valuation_message || message((v.valuation_source as ValuationSource)||'unavailable', v.valuation_date||null); }

export async function getWealthAccountValuations(db: DB, userId:number, asOf:string): Promise<{accounts:AccountValuation[]; breakdown:Record<string,number>}> {
  const [accRes, txRes, priceRes, histRes, snapRes, assetRes, movementRes] = await Promise.all([
    db.prepare(`SELECT * FROM portfolios WHERE user_id=?`).bind(userId).all<any>(),
    db.prepare(`SELECT t.*, a.asset_type, a.pricing_mode FROM investment_transactions t LEFT JOIN investment_assets a ON a.id=t.asset_id WHERE t.user_id=? AND t.trade_date<=? ORDER BY t.trade_date,t.id`).bind(userId, asOf).all<any>(),
    db.prepare(`SELECT pr.* FROM investment_prices pr WHERE pr.user_id=? AND pr.price_date<=? ORDER BY pr.price_date DESC, pr.id DESC`).bind(userId, asOf).all<any>(),
    db.prepare(`SELECT entity_kind,entity_id,amount,recorded_at FROM balance_history WHERE user_id=? AND entity_kind='portfolio' AND recorded_at<=?`).bind(userId, `${asOf} 23:59:59`).all<any>(),
    db.prepare(`SELECT * FROM wealth_valuation_snapshots WHERE user_id=? AND valuation_date<=? ORDER BY valuation_date DESC,id DESC`).bind(userId, asOf).all<any>().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM investment_assets WHERE user_id=?`).bind(userId).all<any>(),
    db.prepare(`SELECT src_kind,src_id,dst_kind,dst_id,amount,date FROM movements WHERE user_id=?`).bind(userId).all<any>().catch(()=>({results:[]})),
  ]);
  const breakdown = emptyBreakdown(); const txByAccount=new Map<number,any[]>(); for(const t of txRes.results) txByAccount.set(t.account_id,[...(txByAccount.get(t.account_id)||[]),t]);
  const assetsByAccount=new Map<number,any[]>(); for(const a of assetRes.results) if(a.account_id) assetsByAccount.set(a.account_id,[...(assetsByAccount.get(a.account_id)||[]),a]);
  const accounts:AccountValuation[]=[];
  for(const a of accRes.results){ const mode=a.valuation_mode||'manual_snapshot'; const warnings:string[]=[]; let holdingsValue=0, holdingCount=0, latestDate:null|string=null, complete=true; const accountTx=txByAccount.get(a.id)||[]; const groups=new Map<number,any[]>(); for(const t of accountTx.filter(t=>t.asset_id)) groups.set(t.asset_id,[...(groups.get(t.asset_id)||[]),t]);
    for(const txs of groups.values()){ const first=txs[0]; const h=calculateHolding(txs, priceRes.results.filter((p:any)=>p.asset_id===first.asset_id), {asOf, assetType:first.asset_type, pricingMode:first.pricing_mode}); if(isZero(h.quantity))continue; holdingCount++; if(h.current_value==null){complete=false; warnings.push(`missing_price: ${first.asset_id}`); warnings.push(`missing valuation for ${first.asset_type || 'asset'} ${first.asset_id}`);} else {holdingsValue+=h.current_value; { const b=bucket(first.asset_type,a.account_type); breakdown[b]+=h.current_value; if(first.asset_type==='stock') breakdown.stocks+=h.current_value; }} if(h.stale_price)warnings.push(`stale price for asset ${first.asset_id}`); if(h.latest_price_date&&(!latestDate||h.latest_price_date>latestDate))latestDate=h.latest_price_date; }
    // Asset-level snapshots are aggregated; account-level snapshot is used only when there are no asset snapshots/holdings to avoid double counting.
    let assetSnapValue=0, assetSnapCount=0; for(const ast of assetsByAccount.get(a.id)||[]){ const s=latest(snapRes.results,a.id,asOf,ast.id); if(s){assetSnapCount++; assetSnapValue+=Number(s.current_value||0); breakdown[bucket(ast.asset_type,a.account_type)]+=Number(s.current_value||0); if(!latestDate||s.valuation_date>latestDate)latestDate=s.valuation_date; if(stale(s.valuation_date,asOf,ast.asset_type,'manual_snapshot'))warnings.push(`stale valuation for ${ast.name}`);} }
    const snap=latest(snapRes.results,a.id,asOf,null); const legacySnap=legacy(histRes.results,a.id,asOf); const legacyCurrent=legacyValue(legacySnap,movementRes.results,a.id); const manualValue=snap?Number(snap.current_value||0):(legacyCurrent!=null?legacyCurrent:Math.round(Number(a.value||0)));
    let formulaValue:null|number=null, formulaStatus='manual_required'; if(['fixed_deposit','ppf','ssy'].includes(a.account_type)){ const fv=a.account_type==='fixed_deposit'?fixedDepositValue(a.metadata,asOf):annualEstimateValue(a.metadata,asOf); formulaStatus=fv.status; if(fv.value!=null) formulaValue=fv.value; warnings.push(...fv.warnings); }
    let value=0, source:ValuationSource='unavailable', sourceRecordId:number|null=null; if(mode==='holdings'){ value=holdingsValue; source='holdings'; if(!holdingCount)warnings.push('No open holdings available'); }
    else if(mode==='formula'){ if(formulaValue!=null){value=formulaValue; source='formula'; latestDate=asOf; breakdown[bucket(null,a.account_type)]+=value;} else {complete=false; warnings.push('Manual valuation required');} }
    else if(mode==='manual_snapshot'){ if(assetSnapCount){value=assetSnapValue; source='manual_snapshot';} else {value=manualValue; source=snap?'manual_snapshot':legacySnap?'legacy_balance_history':'legacy_portfolio_value'; sourceRecordId=snap?.id||legacySnap?.id||a.id; breakdown[bucket(null,a.account_type)]+=value; latestDate=snap?.valuation_date||legacySnap?.recorded_at?.slice(0,10)||latestDate;} }
    else { if(holdingCount&&complete){value=holdingsValue; source='holdings';} else if(snap||assetSnapCount){value=assetSnapCount?assetSnapValue:manualValue; source=assetSnapCount?'hybrid_fallback':'hybrid_fallback'; sourceRecordId=assetSnapCount?null:snap?.id||null; warnings.push('Hybrid fallback used because holdings/prices were incomplete'); if(!assetSnapCount)breakdown[bucket(null,a.account_type)]+=value;} else if(formulaValue!=null){value=formulaValue; source='hybrid_fallback'; latestDate=asOf; breakdown[bucket(null,a.account_type)]+=value; warnings.push('Hybrid formula fallback used');} else {complete=false; warnings.push('Manual valuation required');} }
    const legacyWarning = mode==='manual_snapshot' && (source==='legacy_balance_history'||source==='legacy_portfolio_value');
    if(legacyWarning) warnings.push(message(source, latestDate, true));
    if(stale(latestDate,asOf,a.account_type,source)) warnings.push('Stale valuation: please update manual snapshot');
    const valuationDate=latestDate;
    const valuationStatus=!complete?'partial':source==='unavailable'?'unavailable':legacyWarning?'legacy':'ok';
    accounts.push({account_id:a.id,account_name:a.name,account_type:a.account_type,include_in_net_worth:a.include_in_net_worth!==0,is_active:a.is_active!==0,valuation_mode:mode,value,holdings_value:holdingsValue,manual_snapshot_value:manualValue,valuation_source:source,valuation_date:valuationDate,source_record_id:sourceRecordId,valuation_status:valuationStatus,valuation_message:message(source,valuationDate,legacyWarning),valuation_complete:complete,latest_valuation_date:latestDate,warnings,holding_count:holdingCount,status:formulaStatus}); }
  return {accounts, breakdown};
}
export async function getWealthAggregation(db:DB,userId:number,asOf:string):Promise<WealthAggregation>{ const {accounts,breakdown}=await getWealthAccountValuations(db,userId,asOf); const included=accounts.filter(a=>a.include_in_net_worth&&a.is_active); const warnings=included.flatMap(a=>a.warnings.map(w=>`account ${a.account_id}: ${w}`)); return {total:included.reduce((s,a)=>s+a.value,0),holdings_value:included.reduce((s,a)=>s+a.holdings_value,0),manual_snapshot_value:included.reduce((s,a)=>['manual_snapshot','legacy_balance_history','legacy_portfolio_value','account_snapshot'].includes(a.valuation_source)?s+a.value:s,0),account_count:included.filter(a=>a.value!==0||a.holding_count>0).length,holding_count:included.reduce((s,a)=>s+a.holding_count,0),excluded_value:accounts.filter(a=>!a.include_in_net_worth||!a.is_active).reduce((s,a)=>s+a.value,0),valuation_complete:included.every(a=>a.valuation_complete),warnings,assetBreakdown:breakdown,accounts}; }
