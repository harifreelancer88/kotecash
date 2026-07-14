import { describe, expect, it } from 'vitest';
import { validatePriceCsv } from '../src/server/routes/wealth-market-prices';

function ctx(prices:any[]=[]){
  const assets=[{id:1,user_id:1,name:'Coal India',asset_type:'stock',symbol:'COALINDIA',exchange:'NSE',isin:'INE522F01014',is_active:1},{id:2,user_id:1,name:'Other',asset_type:'stock',symbol:'OTHER',exchange:'NSE',isin:'INE000000002',is_active:1}];
  return {get:()=>1,env:{EOD_PRICE_WARNING_PERCENT:'20',EOD_PRICE_BLOCK_PERCENT:'50',DB:{prepare:(q:string)=>({bind:(...v:any[])=>({first:async()=>{if(q.includes('investment_assets')&&q.includes('id=?'))return assets.find(a=>a.id===Number(v[1]));if(q.includes('UPPER(isin)'))return null;if(q.includes('investment_prices')&&q.includes('price_date=?'))return prices.find(p=>p.asset_id===v[1]&&p.price_date===v[2])||null;if(q.includes('investment_prices'))return prices.filter(p=>p.asset_id===v[1]).sort((a,b)=>b.price_date.localeCompare(a.price_date))[0]||null;return null},all:async()=>{if(q.includes('UPPER(symbol)'))return {results:assets.filter(a=>a.symbol===String(v[1]).toUpperCase()&&a.exchange===String(v[2]).toUpperCase())};return {results:[]}},run:async()=>({meta:{changes:1}})})})}}} as any;
}

describe('EOD price CSV validation',()=>{
  it('maps holdings-template new price fields and ignores existing close', async()=>{
    const csv='asset_id,symbol,exchange,isin,asset_name,quantity,existing_price_date,existing_close,new_price_date,new_close,currency\n1,COALINDIA,NSE,INE522F01014,Coal,10,2026-07-13,999,2026-07-14,101,INR\n';
    const r=await validatePriceCsv(ctx([{asset_id:1,price_date:'2026-07-13',price:'100',source:'import'}]),csv);
    expect(r.rows[0]).toMatchObject({price_date:'2026-07-14',close:'101',status:'valid'});
  });
  it('skips blank template rows and blocks very large changes', async()=>{
    const blank='asset_id,symbol,exchange,isin,asset_name,quantity,existing_price_date,existing_close,new_price_date,new_close,currency\n1,COALINDIA,NSE,INE522F01014,Coal,10,2026-07-13,100,,,INR\n';
    expect((await validatePriceCsv(ctx(),blank)).skipped_blank_rows).toBe(1);
    const bad='symbol,exchange,isin,price_date,close,currency\nCOALINDIA,NSE,,2026-07-14,200,INR\n';
    const r=await validatePriceCsv(ctx([{asset_id:1,price_date:'2026-07-13',price:'100',source:'import'}]),bad);
    expect(r.rows[0].status).toBe('blocked'); expect(r.can_commit).toBe(false);
  });
});
