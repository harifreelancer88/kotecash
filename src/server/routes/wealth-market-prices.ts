import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { marketPriceStatus, refreshMarketPrices } from '../wealth/market-prices';
import { parseCsv } from '../wealth/csv';
import { isDateOnly, normalizeCurrency } from '../wealth/validation';
import { formatDecimal, parseDecimal } from '../wealth/decimal';
const route=new Hono<{Bindings:Bindings;Variables:Variables}>();
const bad=(m:string)=>({error:m});

const today=()=>new Date().toISOString().slice(0,10);
const norm=(v:any)=>String(v??'').trim();
async function resolveAsset(c:any, uid:number, r:any){
  const assetId=Number(r.asset_id||0); if(assetId){ const a=await c.env.DB.prepare('SELECT * FROM investment_assets WHERE user_id=? AND id=?').bind(uid,assetId).first<any>(); return a?{asset:a}:{error:'asset_id not found'}; }
  const isin=norm(r.isin).toUpperCase(); if(isin){ const rows=(await c.env.DB.prepare('SELECT * FROM investment_assets WHERE user_id=? AND UPPER(isin)=?').bind(uid,isin).all<any>()).results; if(rows.length===1)return{asset:rows[0]}; if(rows.length>1)return{error:'ambiguous ISIN'}; }
  const symbol=norm(r.symbol).toUpperCase(), exchange=norm(r.exchange).toUpperCase(); if(symbol&&exchange){ const rows=(await c.env.DB.prepare('SELECT * FROM investment_assets WHERE user_id=? AND UPPER(symbol)=? AND UPPER(exchange)=?').bind(uid,symbol,exchange).all<any>()).results; if(rows.length===1)return{asset:rows[0]}; if(rows.length>1)return{error:'ambiguous symbol and exchange'}; }
  return {error:'asset not found'};
}
async function validatePriceCsv(c:any, text:string){
 const uid=c.get('userId'); const parsed=parseCsv(text,{maxFileSize:2*1024*1024,maxRows:500,maxColumns:20,maxCellLength:1000}); const seen=new Set<string>(); const rows:any[]=[];
 for(const e of parsed.errors) rows.push({row_number:e.rowNumber,status:'failed',reason:e.message});
 for(const row of parsed.rows){ const raw:any={}; for(const [k,v] of Object.entries(row.raw)) raw[k.toLowerCase().trim()]=String(v).trim(); const out:any={row_number:row.rowNumber,status:'valid',raw};
   const res=await resolveAsset(c,uid,raw); if(res.error){out.status='failed';out.reason=res.error;rows.push(out);continue} const a=res.asset; out.asset_id=a.id; out.symbol=a.symbol; out.exchange=a.exchange;
   if(!isDateOnly(raw.price_date)||!raw.price_date){out.status='failed';out.reason='invalid price_date';rows.push(out);continue} if(raw.price_date>today()){out.status='failed';out.reason='future price_date';rows.push(out);continue}
   let price:string; try{price=formatDecimal(parseDecimal(raw.close,{allowZero:false}));}catch{out.status='failed';out.reason='invalid close';rows.push(out);continue}
   const currency=normalizeCurrency(raw.currency||''); if(!currency){out.status='failed';out.reason='invalid currency';rows.push(out);continue}
   if(currency!=='INR'){out.status='failed';out.reason='unsupported currency';rows.push(out);continue}
   const key=`${a.id}:${raw.price_date}`; if(seen.has(key)){out.status='failed';out.reason='duplicate row';rows.push(out);continue} seen.add(key);
   const same=await c.env.DB.prepare('SELECT source FROM investment_prices WHERE user_id=? AND asset_id=? AND price_date=?').bind(uid,a.id,raw.price_date).first<any>(); if(same&&same.source!=='market'){out.status='failed';out.reason='same-date manual/import price protected';rows.push(out);continue}
   Object.assign(out,{price_date:raw.price_date,close:price,currency,provider_symbol:raw.provider_symbol||null,notes:raw.notes||null}); rows.push(out);
 }
 return {headers:parsed.headers,total_rows:parsed.rows.length,valid_rows:rows.filter(r=>r.status==='valid').length,invalid_rows:rows.filter(r=>r.status!=='valid').length,rows};
}

route.get('/status', async c=>c.json(await marketPriceStatus(c as any)));
route.get('/template', c=>new Response('symbol,exchange,isin,price_date,close,currency\n',{headers:{'content-type':'text/csv','content-disposition':'attachment; filename=market-price-template.csv'}}));
route.post('/import-csv', async c=>{ try{ const form=await c.req.formData(); const commit=String(form.get('commit')||'false')==='true'; const file=form.get('file'); if(!(file instanceof File)) return c.json(bad('CSV file is required'),400); const text=await file.text(); const preview=await validatePriceCsv(c as any,text); if(!commit) return c.json({...preview,committed:false}); if(preview.invalid_rows) return c.json({...preview,committed:false,error:'Commit requires a valid preview'},400); const uid=c.get('userId'); let committed=0; for(const r of preview.rows){ await c.env.DB.prepare(`INSERT INTO investment_prices (user_id,asset_id,price_date,price,currency,source,notes) VALUES (?,?,?,?,?,'import',?) ON CONFLICT(user_id,asset_id,price_date) DO UPDATE SET price=excluded.price,currency=excluded.currency,source=excluded.source,notes=excluded.notes,updated_at=datetime('now')`).bind(uid,r.asset_id,r.price_date,r.close,r.currency,r.notes||'manual EOD CSV').run(); committed++; } return c.json({...preview,committed:true,committed_rows:committed}); }catch(e:any){ return c.json(bad(e.message||'CSV import failed'),400); }});
route.post('/refresh', async c=>{ try{ const b=await c.req.json().catch(()=>({})); const ids=Array.isArray(b.asset_ids)?b.asset_ids.map(Number).filter(Boolean):undefined; const out=await refreshMarketPrices(c as any,{asset_ids:ids,only_open_holdings:b.only_open_holdings!==false,force:b.force===true}); const code=out.failed&&out.updated===0?400:200; return c.json(out,code as any); }catch(e:any){ return c.json(bad(e.message||'Refresh failed'),400); }});
export default route;
