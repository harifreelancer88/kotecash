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
    const cases=[['{',/Malformed provider response|Invalid provider JSON/], [JSON.stringify({symbol:'ABC',exchange:'NSE',currency:'USD',close:'1'}),/currency mismatch/], [JSON.stringify({symbol:'XYZ',exchange:'NSE',currency:'INR',close:'1'}),/symbol mismatch/], [JSON.stringify({symbol:'ABC',exchange:'NSE',currency:'INR'}),/missing price/]] as const;
    for(const [body,rx] of cases){ const f=vi.spyOn(globalThis,'fetch' as any).mockResolvedValueOnce(new Response(body,{status:200}) as any); const r=await new TwelveDataProvider('SECRET_API_KEY_123456').getQuote({symbol:'ABC',exchange:'NSE'}); expect(r.ok).toBe(false); if(!r.ok) expect(r.error).toMatch(rx); expect(JSON.stringify(r)).not.toContain('SECRET_API_KEY'); f.mockRestore(); }
  });
});

function db(){ const calls:string[]=[]; const assets=[{id:1,user_id:1,asset_type:'stock',name:'Coal',symbol:'COALINDIA',exchange:'NSE',is_active:1,pricing_mode:'market',price_source:'market',has_open_holding:1,latest_price_date:null,latest_source:null},{id:2,user_id:1,asset_type:'stock',name:'Closed',symbol:'CLOSED',exchange:'NSE',is_active:1,pricing_mode:'market',price_source:'market',has_open_holding:0,latest_price_date:null,latest_source:null},{id:3,user_id:1,asset_type:'mutual_fund',name:'Fund',symbol:null,exchange:null,is_active:1,pricing_mode:'manual',price_source:'manual',has_open_holding:1,latest_price_date:null,latest_source:null}]; return {calls, prepare:(q:string)=>{calls.push(q); return {bind:(..._v:any[])=>({all:async()=>({results:q.includes('FROM investment_assets')?(q.includes('a.id IN')?assets.slice(0,1):assets):[]}),first:async()=>null,run:async()=>({success:true,meta:{last_row_id:9,changes:1}})})}}} as any; }

describe('market price refresh service',()=>{
  it('refreshes open stock holdings only and never creates movements or transactions', async()=>{
    const d=db(); const app=new Hono<{Variables:{userId:number},Bindings:any}>(); app.use('*',async(c,n)=>{c.set('userId',1);await n();});
    const c:any={env:{DB:d,MARKET_DATA_PROVIDER:'twelve_data',TWELVE_DATA_API_KEY:'configured'},get:()=>1};
    const provider:any={name:'mock',getQuotes:vi.fn(async()=>[{ok:true,request:{symbol:'COALINDIA',exchange:'NSE'},quote:{provider:'mock',provider_timestamp:'2026-07-14T00:00:00Z',market_timestamp:'2026-07-13T00:00:00Z',currency:'INR',symbol:'COALINDIA',exchange:'NSE',price:'301.25',raw_status:'ok',data_kind:'eod'}}])};
    const r=await refreshMarketPrices(c,{only_open_holdings:true,provider});
    expect(r.updated).toBe(1); expect(r.skipped).toBe(2); expect(provider.getQuotes).toHaveBeenCalledTimes(1); expect(d.calls.join('\n')).not.toMatch(/INSERT INTO investment_transactions|INSERT INTO movements/i);
  });
});

describe('Twelve Data diagnostics and request format',()=>{
  async function fail(body:any,status=200){ const f=vi.spyOn(globalThis,'fetch' as any).mockResolvedValueOnce(new Response(JSON.stringify(body),{status}) as any); const r=await new TwelveDataProvider('SECRET_API_KEY_123456').getQuote({symbol:'ABC',exchange:'NSE'}); f.mockRestore(); return r as any; }
  it('uses separate uppercase symbol and exchange params for NSE and BSE', async()=>{
    const f=vi.spyOn(globalThis,'fetch' as any).mockResolvedValue(new Response(JSON.stringify({symbol:'COALINDIA',exchange:'NSE',currency:'INR',close:'1',datetime:'2026-07-13 15:30:00'}),{status:200}) as any);
    await new TwelveDataProvider('SECRET_API_KEY_123456','https://example.test').getQuote({symbol:'coalindia',exchange:'NSE'});
    await new TwelveDataProvider('SECRET_API_KEY_123456','https://example.test').getQuote({symbol:'HINDALCO',exchange:'NSE'});
    await new TwelveDataProvider('SECRET_API_KEY_123456','https://example.test').getQuote({symbol:'500325',exchange:'BSE'});
    const urls=f.mock.calls.map(c=>new URL(String(c[0])));
    expect(urls[0].searchParams.get('symbol')).toBe('COALINDIA'); expect(urls[0].searchParams.get('exchange')).toBe('NSE');
    expect(urls[1].searchParams.get('symbol')).toBe('HINDALCO'); expect(urls[1].searchParams.get('exchange')).toBe('NSE');
    expect(urls[2].searchParams.get('symbol')).toBe('500325'); expect(urls[2].searchParams.get('exchange')).toBe('BSE');
    expect(JSON.stringify(urls.map(String))).toContain('SECRET_API_KEY'); f.mockRestore();
  });
  it('classifies authentication, plan, rate, quota, not found, 5xx and redacts secrets', async()=>{
    const cases:any[]=[
      [{status:'error',code:401,message:'Invalid API key SECRET_API_KEY_123456'},401,'provider_authentication_failed'],
      [{status:'error',code:403,message:'Your plan does not include this exchange'},200,'plan_access_restricted'],
      [{status:'error',code:429,message:'rate limit exceeded'},429,'rate_limited'],
      [{status:'error',code:429,message:'quota exceeded'},200,'quota_exceeded'],
      [{status:'error',code:404,message:'symbol not found'},200,'symbol_not_found'],
      [{status:'error',code:500,message:'server error'},500,'provider_5xx'],
    ];
    for(const [body,status,code] of cases){ const r=await fail(body,status); expect(r.ok).toBe(false); expect(r.error_code).toBe(code); expect(JSON.stringify(r)).not.toContain('SECRET_API_KEY'); }
  });
  it('classifies timeout and malformed responses', async()=>{
    const f=vi.spyOn(globalThis,'fetch' as any).mockRejectedValueOnce(Object.assign(new Error('aborted'),{name:'AbortError'}));
    const r=await new TwelveDataProvider('SECRET_API_KEY_123456').getQuote({symbol:'ABC',exchange:'NSE'}); expect((r as any).error_code).toBe('timeout'); f.mockRestore();
    const f2=vi.spyOn(globalThis,'fetch' as any).mockResolvedValueOnce(new Response('{',{status:200}) as any);
    const r2=await new TwelveDataProvider('SECRET_API_KEY_123456').getQuote({symbol:'ABC',exchange:'NSE'}); expect((r2 as any).error_code).toBe('malformed_provider_response'); f2.mockRestore();
  });
});

describe('market price full-request failures',()=>{
  it('returns a visible top-level and synthetic result for provider-not-configured', async()=>{
    const d=db(); const c:any={env:{DB:d,MARKET_DATA_PROVIDER:'twelve_data'},get:()=>1};
    const r=await refreshMarketPrices(c,{only_open_holdings:true});
    expect(r.status).toBe('failed'); expect(r.error?.error_code).toBe('provider_not_configured'); expect(r.results.length).toBeGreaterThan(0); expect(r.results[0].safe_message).toMatch(/not configured/i);
  });
  it('carries safe provider failure details for a single asset refresh', async()=>{
    const d=db(); const c:any={env:{DB:d,MARKET_DATA_PROVIDER:'twelve_data',TWELVE_DATA_API_KEY:'configured'},get:()=>1};
    const provider:any={name:'mock',getQuotes:vi.fn(async()=>[{ok:false,request:{symbol:'COALINDIA',exchange:'NSE'},error:'Your plan does not include this exchange',safe_message:'Your plan does not include this exchange',error_code:'plan_access_restricted',provider_http_status:200,retryable:false}])};
    const r=await refreshMarketPrices(c,{asset_ids:[1],only_open_holdings:false,force:true,provider});
    expect(provider.getQuotes.mock.calls[0][0]).toEqual([{symbol:'COALINDIA',exchange:'NSE',assetId:1}]);
    expect(r.requested).toBe(1); expect(r.failed).toBe(1); expect(r.error?.error_code).toBe('plan_access_restricted'); expect(JSON.stringify(r)).not.toMatch(/API_KEY|apikey=/i);
  });
});
