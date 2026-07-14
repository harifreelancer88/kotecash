import { Hono } from 'hono';
import type { AppContext, Bindings, Variables } from '../types';
import { SNAPSHOT_SOURCES } from '../wealth/types';
import { isDateOnly, isEnumValue, optionalText } from '../wealth/validation';

const route = new Hono<{ Bindings: Bindings; Variables: Variables }>();
function bad(error:string){return {error};}
function money(v:any, name:string, required=false){ if(v==null||v==='') { if(required) throw new Error(`${name} required`); return null; } const n=Number(v); if(!Number.isInteger(n)||n<0) throw new Error(`Invalid ${name}`); return n; }
async function ownAccount(c:AppContext, uid:number, id:number){ return c.env.DB.prepare('SELECT id FROM portfolios WHERE id=? AND user_id=?').bind(id,uid).first<any>(); }
async function ownAsset(c:AppContext, uid:number, id:number){ return c.env.DB.prepare('SELECT id FROM investment_assets WHERE id=? AND user_id=?').bind(id,uid).first<any>(); }
async function normalize(c:AppContext, uid:number, body:any, partial=false){ const v:any={};
  const aid = body.account_id==null||body.account_id==='' ? null : Number(body.account_id); if(!partial||body.account_id!=null){ if(!Number.isInteger(aid)) throw new Error('Invalid account_id'); if(!await ownAccount(c,uid,aid!)) throw new Error('Invalid account ownership'); v.account_id=aid; }
  const assetId = body.asset_id==null||body.asset_id==='' ? null : Number(body.asset_id); if(!partial||'asset_id' in body){ if(assetId!=null&&(!Number.isInteger(assetId)||!await ownAsset(c,uid,assetId))) throw new Error('Invalid asset ownership'); v.asset_id=assetId; }
  if(!partial||'valuation_date' in body){ if(!isDateOnly(body.valuation_date)||!body.valuation_date) throw new Error('Invalid valuation_date'); const today=new Date().toISOString().slice(0,10); if(body.valuation_date>today) throw new Error('Future valuation_date not supported'); v.valuation_date=body.valuation_date; }
  for(const f of ['invested_value','accrued_interest','contribution_total','employer_contribution','employee_contribution'] as const) if(!partial||f in body) v[f]=money(body[f], f);
  if(!partial||'current_value' in body) v.current_value=money(body.current_value,'current_value',true);
  if(!partial||'source' in body){ const src=body.source??'manual'; if(!isEnumValue(SNAPSHOT_SOURCES, src)) throw new Error('Invalid source'); v.source=src; }
  if(!partial||'notes' in body) v.notes=optionalText(body.notes); return v; }
route.get('/latest', async c=>{ const uid=c.get('userId'); const rows=await c.env.DB.prepare(`SELECT s.* FROM wealth_valuation_snapshots s JOIN (SELECT account_id, COALESCE(asset_id,-1) asset_key, MAX(valuation_date) valuation_date FROM wealth_valuation_snapshots WHERE user_id=? AND valuation_date<=date('now') GROUP BY account_id, COALESCE(asset_id,-1)) x ON x.account_id=s.account_id AND x.asset_key=COALESCE(s.asset_id,-1) AND x.valuation_date=s.valuation_date WHERE s.user_id=? ORDER BY s.account_id,s.asset_id`).bind(uid,uid).all(); return c.json(rows.results); });
route.get('/', async c=>{ const uid=c.get('userId'); const wh=['user_id=?']; const b:any[]=[uid]; for(const [q,f] of [['account_id','account_id'],['asset_id','asset_id']] as any){const v=c.req.query(q); if(v){wh.push(`${f}=?`); b.push(Number(v));}} const from=c.req.query('date_from'), to=c.req.query('date_to'); if(from){wh.push('valuation_date>=?'); b.push(from)} if(to){wh.push('valuation_date<=?'); b.push(to)} let sql=`SELECT * FROM wealth_valuation_snapshots WHERE ${wh.join(' AND ')} ORDER BY valuation_date DESC,id DESC`; if(c.req.query('latest_only')==='true') sql=`SELECT * FROM (${sql}) GROUP BY account_id, COALESCE(asset_id,-1)`; const rows=await c.env.DB.prepare(sql).bind(...b).all(); return c.json(rows.results); });

async function legacyPreview(c:AppContext, uid:number, body:any){
  const accountId=Number(body.account_id);
  if(!Number.isInteger(accountId)) throw new Error('Invalid account_id');
  const account=await c.env.DB.prepare('SELECT id,name,account_type,valuation_mode,value FROM portfolios WHERE id=? AND user_id=?').bind(accountId,uid).first<any>();
  if(!account) throw new Error('Invalid account ownership');
  const existingCount=await c.env.DB.prepare('SELECT COUNT(*) count FROM wealth_valuation_snapshots WHERE user_id=? AND account_id=? AND asset_id IS NULL').bind(uid,accountId).first<any>();
  const hist=await c.env.DB.prepare("SELECT id,amount,recorded_at FROM balance_history WHERE user_id=? AND entity_kind='portfolio' AND entity_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1").bind(uid,accountId).first<any>();
  const source=hist?'legacy_balance_history':'legacy_portfolio_value';
  const value=hist?Math.round(Number(hist.amount||0)):Math.round(Number(account.value||0));
  const sourceDate=hist?.recorded_at?.slice(0,10)||null;
  const selectedDate=body.valuation_date||sourceDate;
  if(!selectedDate) throw new Error('valuation_date required when the legacy source has no reliable date');
  if(!isDateOnly(selectedDate)) throw new Error('Invalid valuation_date');
  const today=new Date().toISOString().slice(0,10); if(selectedDate>today) throw new Error('Future valuation_date not supported');
  const existingForDate=await c.env.DB.prepare('SELECT id,current_value,source FROM wealth_valuation_snapshots WHERE user_id=? AND account_id=? AND asset_id IS NULL AND valuation_date=?').bind(uid,accountId,selectedDate).first<any>();
  if(Number(existingCount?.count||0)>0&&!existingForDate) throw new Error('Account already has manual valuation snapshots');
  return { account_id:accountId, account_name:account.name, account_type:account.account_type, valuation_mode:account.valuation_mode, current_value:value, valuation_date:selectedDate, source, source_record_id:hist?.id||account.id, existing_snapshot_id:existingForDate?.id||null, will_create:!existingForDate };
}

route.post('/legacy-preview', async c=>{ const uid=c.get('userId'); try{return c.json(await legacyPreview(c,uid,await c.req.json()));}catch(e:any){return c.json(bad(e.message),400)} });
route.post('/from-legacy', async c=>{ const uid=c.get('userId'); try{const body=await c.req.json(); if(body.confirm!==true) throw new Error('Confirmation required'); const p=await legacyPreview(c,uid,body); if(p.existing_snapshot_id) return c.json({id:p.existing_snapshot_id, created:false, preview:p}); const r=await c.env.DB.prepare(`INSERT INTO wealth_valuation_snapshots (user_id, account_id, asset_id, valuation_date, current_value, source, notes) VALUES (?, ?, NULL, ?, ?, 'migration', ?)`).bind(uid,p.account_id,p.valuation_date,p.current_value,optionalText(body.notes)||'Created from legacy account value').run(); return c.json({id:r.meta.last_row_id, created:true, preview:p},201);}catch(e:any){return c.json(bad(e.message),400)} });
route.post('/', async c=>{ const uid=c.get('userId'); try{const v=await normalize(c,uid,await c.req.json()); const existing=await c.env.DB.prepare(`SELECT id FROM wealth_valuation_snapshots WHERE user_id=? AND account_id=? AND ${v.asset_id==null?'asset_id IS NULL':'asset_id=?'} AND valuation_date=?`).bind(...(v.asset_id==null?[uid,v.account_id,v.valuation_date]:[uid,v.account_id,v.asset_id,v.valuation_date])).first<any>(); const f=Object.keys(v); if(existing){ const editable=f.filter(k=>!['account_id','asset_id','valuation_date'].includes(k)); await c.env.DB.prepare(`UPDATE wealth_valuation_snapshots SET ${editable.map(k=>`${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(...editable.map(k=>v[k]),existing.id,uid).run(); return c.json({id:existing.id, upserted:true, updated:true},200); } const r=await c.env.DB.prepare(`INSERT INTO wealth_valuation_snapshots (user_id, ${f.join(',')}) VALUES (?, ${f.map(()=>'?').join(',')})`).bind(uid,...f.map(k=>v[k])).run(); return c.json({id:r.meta.last_row_id, upserted:false},201);}catch(e:any){return c.json(bad(e.message),400)} });
route.put('/:id', async c=>{ const uid=c.get('userId'), id=Number(c.req.param('id')); const ex=await c.env.DB.prepare('SELECT * FROM wealth_valuation_snapshots WHERE id=? AND user_id=?').bind(id,uid).first<any>(); if(!ex)return c.json(bad('Not found'),404); try{const v=await normalize(c,uid,await c.req.json(),true); const f=Object.keys(v); if(!f.length)return c.json({success:true}); await c.env.DB.prepare(`UPDATE wealth_valuation_snapshots SET ${f.map(k=>`${k}=?`).join(', ')}, updated_at=datetime('now') WHERE id=? AND user_id=?`).bind(...f.map(k=>v[k]),id,uid).run(); return c.json({success:true});}catch(e:any){return c.json(bad(e.message),400)} });
route.delete('/:id', async c=>{ const uid=c.get('userId'), id=Number(c.req.param('id')); const r=await c.env.DB.prepare('DELETE FROM wealth_valuation_snapshots WHERE id=? AND user_id=?').bind(id,uid).run(); if((r.meta as any).changes===0)return c.json(bad('Not found'),404); return c.json({success:true}); });
export default route;
