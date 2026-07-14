import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import wealthOverview from '../src/server/routes/wealth-overview';
function rows(){return [
 {id:1,user_id:1,account_id:1,account_name:'Broker',institution:'Zerodha',valuation_mode:'holdings',asset_id:1,asset_name:'Alpha',symbol:'AAA',asset_type:'stock',pricing_mode:'manual',transaction_type:'buy',trade_date:'2026-01-01',quantity:'10',gross_amount:1000},
 {id:2,user_id:1,account_id:1,account_name:'Broker',institution:'Zerodha',valuation_mode:'holdings',asset_id:2,asset_name:'Beta',symbol:'BBB',asset_type:'stock',pricing_mode:'manual',transaction_type:'buy',trade_date:'2026-01-01',quantity:'10',gross_amount:2000},
 {id:3,user_id:1,account_id:2,account_name:'Hidden',institution:'Nope',valuation_mode:'holdings',asset_id:3,asset_name:'Excluded',symbol:'XXX',asset_type:'stock',pricing_mode:'manual',transaction_type:'buy',trade_date:'2026-01-01',quantity:'10',gross_amount:9999},
];}
function db(){return {prepare:vi.fn((q:string)=>({bind:vi.fn((...args:any[])=>({
 all:vi.fn(async()=>{ if(q.includes('FROM investment_transactions t JOIN portfolios')&&q.includes('trade_date')) return {results:rows().filter(r=>r.account_name!=='Hidden')}; if(q.includes('FROM investment_prices')) return {results:[{asset_id:1,price_date:'2026-07-10',price:'150',source:'manual'}]}; if(q.includes('ORDER BY t.trade_date DESC')) return {results:[{id:1,trade_date:'2026-01-01',transaction_type:'buy',quantity:'10',gross_amount:1000,net_amount:1000,account:'Broker',asset_name:'Alpha',symbol:'AAA'}]}; return {results:[]};}),
 first:vi.fn(async()=>{ if(q.includes('COUNT(*)')) return {count:1}; if(q.includes('SELECT id FROM portfolios')) return args[0]===99?null:{id:args[0]}; return null; })
}))}))} as any;}
function app(database=db(), user=true){const a=new Hono<{Variables:{userId:number}}>(); if(user)a.use('*',async(c,n)=>{c.set('userId',1); await n();}); a.route('/api/wealth/overview',wealthOverview); return {app:a, env:{DB:database} as any};}
describe('wealth overview route',()=>{
 it('returns partial valuation summary, analytics, allocations and no invalid numbers',async()=>{const h=app(); const r=await h.app.request('/api/wealth/overview?as_of=2026-07-14',{},h.env); expect(r.status).toBe(200); const j:any=await r.json(); expect(j.summary.current_value).toBe(1500); expect(j.summary.valuation_complete).toBe(false); expect(j.summary.missing_price_assets).toBe(1); expect(j.top_gainers.map((x:any)=>x.symbol)).toEqual(['AAA']); expect(j.top_losers).toHaveLength(0); expect(j.allocations.asset[0].percentage_of_priced_portfolio).toBe(100); expect(j.valuation_health.messages.join(' ')).toMatch(/missing prices|partial/); expect(JSON.stringify(j)).not.toMatch(/NaN|Infinity/); expect(j.summary.warnings).toEqual([]);});
 it('validates as_of and account ownership',async()=>{const h=app(); expect((await h.app.request('/api/wealth/overview?as_of=bad',{},h.env)).status).toBe(400); expect((await h.app.request('/api/wealth/overview?account_id=99',{},h.env)).status).toBe(404);});
});
