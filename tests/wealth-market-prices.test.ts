import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { TwelveDataProvider } from '../src/server/market-data/twelve-data';
import { refreshMarketPrices } from '../src/server/wealth/market-prices';

describe('Twelve Data provider adapter',()=>{
  it('normalizes a valid NSE quote without leaking the API key', async()=>{
    const fetchMock=vi.spyOn(globalThis,'fetch' as any).mockResolvedValueOnce(new Response(JSON.stringify({symbol:'COALINDIA',exchange:'NSE',currency:'INR',close:'120.50',datetime:'2026-07-13 15:30:00'}),{status:200}) as any);
    const p=new TwelveDataProvider('SECRET_API_KEY_123456'); const r=await p.getQuote({symbol:'coalindia',exchange:'NSE'});
    expect(r.ok).toBe(true); if(r.ok) expect(r.quote).toMatchObject({provider:'twelve_data',symbol:'COALINDIA',exchange:'NSE',currency:'INR',price:'120.5'});
    expect(JSON.stringify(r)).not.toContain('SECRET_API_KEY'); fetchMock.mockRestore();
  });
  it('returns safe failures for malformed, missing price, currency mismatch, and symbol mismatch', async()=>{
    const cases=[['{',/Invalid provider JSON/], [JSON.stringify({symbol:'ABC',exchange:'NSE',currency:'USD',close:'1'}),/currency mismatch/], [JSON.stringify({symbol:'XYZ',exchange:'NSE',currency:'INR',close:'1'}),/symbol mismatch/], [JSON.stringify({symbol:'ABC',exchange:'NSE',currency:'INR'}),/missing price/]] as const;
    for(const [body,rx] of cases){ const f=vi.spyOn(globalThis,'fetch' as any).mockResolvedValueOnce(new Response(body,{status:200}) as any); const r=await new TwelveDataProvider('SECRET_API_KEY_123456').getQuote({symbol:'ABC',exchange:'NSE'}); expect(r.ok).toBe(false); if(!r.ok) expect(r.error).toMatch(rx); expect(JSON.stringify(r)).not.toContain('SECRET_API_KEY'); f.mockRestore(); }
  });
});

function db(){ const calls:string[]=[]; const assets=[{id:1,user_id:1,asset_type:'stock',name:'Coal',symbol:'COALINDIA',exchange:'NSE',is_active:1,pricing_mode:'market',price_source:'market',has_open_holding:1,latest_price_date:null,latest_source:null},{id:2,user_id:1,asset_type:'stock',name:'Closed',symbol:'CLOSED',exchange:'NSE',is_active:1,pricing_mode:'market',price_source:'market',has_open_holding:0,latest_price_date:null,latest_source:null},{id:3,user_id:1,asset_type:'mutual_fund',name:'Fund',symbol:null,exchange:null,is_active:1,pricing_mode:'manual',price_source:'manual',has_open_holding:1,latest_price_date:null,latest_source:null}]; return {calls, prepare:(q:string)=>{calls.push(q); return {bind:(..._v:any[])=>({all:async()=>({results:q.includes('FROM investment_assets')?assets:[]}),first:async()=>null,run:async()=>({success:true,meta:{last_row_id:9,changes:1}})})}}} as any; }

describe('market price refresh service',()=>{
  it('refreshes open stock holdings only and never creates movements or transactions', async()=>{
    const d=db(); const app=new Hono<{Variables:{userId:number},Bindings:any}>(); app.use('*',async(c,n)=>{c.set('userId',1);await n();});
    const c:any={env:{DB:d,MARKET_DATA_PROVIDER:'twelve_data',TWELVE_DATA_API_KEY:'configured'},get:()=>1};
    const provider:any={name:'mock',getQuotes:vi.fn(async()=>[{ok:true,request:{symbol:'COALINDIA',exchange:'NSE'},quote:{provider:'mock',provider_timestamp:'2026-07-14T00:00:00Z',market_timestamp:'2026-07-13T00:00:00Z',currency:'INR',symbol:'COALINDIA',exchange:'NSE',price:'301.25',raw_status:'ok',data_kind:'eod'}}])};
    const r=await refreshMarketPrices(c,{only_open_holdings:true,provider});
    expect(r.updated).toBe(1); expect(r.skipped).toBe(2); expect(provider.getQuotes).toHaveBeenCalledTimes(1); expect(d.calls.join('\n')).not.toMatch(/INSERT INTO investment_transactions|INSERT INTO movements/i);
  });
});
