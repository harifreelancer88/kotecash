import type { AppContext } from './types';

export const SNAPSHOT_SOURCES = ['manual','statement','import','opening_balance','migration','reconciliation_adjustment'] as const;
export const RECON_STATUSES = ['draft','in_review','reconciled','small_difference','unreconciled','locked','cancelled'] as const;
export function finiteInt(v:any, name='amount'){ const n=Number(v); if(!Number.isFinite(n)) throw new Error(`${name} must be finite`); return Math.round(n); }
export function assertDate(d:any, name='date'){ if(!/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))) throw new Error(`${name} must be YYYY-MM-DD`); return String(d); }
export async function wallet(c:AppContext, uid:number, id:any){ return c.env.DB.prepare('SELECT * FROM wallets WHERE user_id=? AND id=?').bind(uid,id).first<any>(); }
export async function audit(c:AppContext, uid:number, event_type:string, summary:any={}, reconciliation_id:any=null, snapshot_id:any=null){
  await c.env.DB.prepare('INSERT INTO account_reconciliation_audit_events (user_id,reconciliation_id,snapshot_id,event_type,summary_json) VALUES (?,?,?,?,?)').bind(uid,reconciliation_id,snapshot_id,event_type,JSON.stringify(summary)).run();
}
export async function calculateBalance(c:AppContext, uid:number, walletId:number, asOf:string){
  asOf=assertDate(asOf,'as_of'); const w=await wallet(c,uid,walletId); if(!w) throw new Error('Wallet not found');
  const opening=await c.env.DB.prepare(`SELECT * FROM account_balance_snapshots WHERE user_id=? AND wallet_id=? AND source='opening_balance' AND date(snapshot_date)<=date(?) ORDER BY date(snapshot_date) DESC,id DESC LIMIT 1`).bind(uid,walletId,asOf).first<any>();
  const start=opening?.snapshot_date || '0001-01-01'; const openingBalance=opening?Number(opening.balance):Number(w.initial_balance||0);
  const m=(await c.env.DB.prepare(`SELECT * FROM movements WHERE user_id=? AND date(date)>date(?) AND date(date)<=date(?) AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?)) ORDER BY date,id`).bind(uid,start,asOf,walletId,walletId).all<any>()).results;
  let credits=0,debits=0,inTransfers=0,outTransfers=0,adjustments=0; const warnings:string[]=[];
  for(const r of m){ const amt=finiteInt(r.amount); const into=r.dst_kind==='wallet'&&Number(r.dst_id)===walletId; const out=r.src_kind==='wallet'&&Number(r.src_id)===walletId; const transfer=(r.src_kind&&r.dst_kind); const desc=String(r.description||'').toLowerCase(); const adjustment=desc.includes('[reconciliation adjustment]'); if(adjustment){ adjustments += into?amt:-amt; continue; } if(into){ if(transfer) inTransfers+=amt; else credits+=amt; } if(out){ if(transfer) outTransfers+=amt; else debits+=amt; } }
  if(!opening) warnings.push('No explicit opening balance; wallet initial_balance used.');
  const pre=await c.env.DB.prepare(`SELECT COUNT(*) count FROM movements WHERE user_id=? AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?)) AND date(date)<date(?)`).bind(uid,walletId,walletId,start).first<any>();
  if(opening && pre?.count) warnings.push('Transactions exist before the opening-balance date.');
  const expected=openingBalance+credits-debits+inTransfers-outTransfers+adjustments;
  const actual=await c.env.DB.prepare(`SELECT * FROM account_balance_snapshots WHERE user_id=? AND wallet_id=? AND source<>'opening_balance' AND date(snapshot_date)<=date(?) ORDER BY date(snapshot_date) DESC,id DESC LIMIT 1`).bind(uid,walletId,asOf).first<any>();
  const diff=actual?expected-Number(actual.balance):null;
  return {wallet_id:walletId,as_of:asOf,opening_balance:openingBalance,total_credits:credits,total_debits:debits,incoming_transfers:inTransfers,outgoing_transfers:outTransfers,adjustments,expected_balance:expected,latest_actual_snapshot:actual?.balance??null,actual_snapshot_date:actual?.snapshot_date??null,reconciliation_difference:diff,reconciliation_status:!opening?'no_opening_balance':!actual?'no_snapshot':Math.abs(diff)<=1?'reconciled':Math.abs(diff)<=100?'minor_difference':'unreconciled',valuation:{source:actual?.source??(opening?'calculated_from_opening':'wallet_initial_balance'),currency:actual?.currency??'IDR'},warnings};
}
export async function previewReconciliation(c:AppContext, uid:number, rec:any){
  const bal=await calculateBalance(c,uid,Number(rec.wallet_id),rec.period_end); const startBal=rec.opening_balance ?? (await calculateBalance(c,uid,Number(rec.wallet_id),rec.period_start)).expected_balance;
  const mv=(await c.env.DB.prepare(`SELECT * FROM movements WHERE user_id=? AND date(date)>=date(?) AND date(date)<=date(?) AND ((src_kind='wallet' AND src_id=?) OR (dst_kind='wallet' AND dst_id=?))`).bind(uid,rec.period_start,rec.period_end,rec.wallet_id,rec.wallet_id).all<any>()).results;
  let credits=0,debits=0,transfers=0; for(const r of mv){ const a=Number(r.amount); if(r.dst_kind==='wallet'&&Number(r.dst_id)===Number(rec.wallet_id)){ if(r.src_kind) transfers+=a; else credits+=a; } if(r.src_kind==='wallet'&&Number(r.src_id)===Number(rec.wallet_id)){ if(r.dst_kind) transfers-=a; else debits+=a; } }
  const expected=Number(startBal)+credits-debits+transfers; const statement=rec.statement_closing_balance==null?null:Number(rec.statement_closing_balance); const difference=statement==null?null:expected-statement;
  const counts=await c.env.DB.prepare(`SELECT SUM(match_status IN ('exact','probable','resolved')) matched, SUM(match_status='unmatched') unmatched, SUM(resolution='mark_duplicate') duplicates, SUM(row_type='balance_adjustment') adjustments, SUM(match_status='excluded') excluded FROM account_reconciliation_rows WHERE user_id=? AND reconciliation_id=?`).bind(uid,rec.id).first<any>();
  const status=statement==null||startBal==null?'unreconciled':Math.abs(difference)<=1?'reconciled':Math.abs(difference)<=100?'small_difference':'unreconciled';
  return {opening_balance:Number(startBal),total_credits:credits,total_debits:debits,net_movement:credits-debits+transfers,transfer_effects:transfers,expected_closing_balance:expected,statement_closing_balance:statement,difference,matched_movement_count:counts?.matched||0,unmatched_statement_count:counts?.unmatched||0,unmatched_ledger_count:0,probable_duplicates:counts?.duplicates||0,excluded_rows:counts?.excluded||0,adjustment_rows:counts?.adjustments||0,reconciliation_status:status,balance_as_of:bal};
}
