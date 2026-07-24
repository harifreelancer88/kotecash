import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import { normalizeProviderCounts, normalizeRefreshResults, refreshHistory, isEligibleForAutomaticRefresh } from '../src/server/wealth/indian-market-refresh';

describe('wealth refresh history normalization',()=>{
  it('normalizes provider counts from objects, JSON strings and nulls',()=>{
    expect(normalizeProviderCounts({nse_bhavcopy:2,yahoo_finance:1})).toMatchObject({nse_bhavcopy:2,yahoo_finance:1,mfapi:0});
    expect(normalizeProviderCounts('{"nse_bhavcopy":3}')).toMatchObject({nse_bhavcopy:3,yahoo_finance:0,mfapi:0});
    expect(normalizeProviderCounts(null)).toEqual({nse_bhavcopy:0,yahoo_finance:0,mfapi:0});
  });
  it('returns empty results for malformed historical result_json',()=>{
    expect(normalizeRefreshResults('{bad')).toEqual([]);
  });
  it('returns empty refresh history safely',async()=>{
    const c:any={get:()=>1,env:{DB:{prepare:()=>({bind:()=>({all:async()=>({results:[]})})})}}};
    await expect(refreshHistory(c)).resolves.toEqual([]);
  });
  it('normalizes D1 JSON strings before returning API rows',async()=>{
    const row={id:7,provider_counts_json:'{"nse_bhavcopy":2,"yahoo_finance":1}',result_json:'[{"assetId":1,"status":"updated"}]'};
    const c:any={get:()=>1,env:{DB:{prepare:()=>({bind:()=>({first:async()=>row})})}}};
    await expect(refreshHistory(c,7)).resolves.toMatchObject({providers:{nse_bhavcopy:2,yahoo_finance:1,mfapi:0},results:[{assetId:1,status:'updated'}]});
  });
});

describe('wealth prices browser rendering',()=>{
  async function renderWith(history:any, prices:any[]=[], assets:any[]=[]) {
    const context:any={console,document:{getElementById:()=>null},window:{}};
    context.window.WealthHelpers={esc:(v:any)=>String(v??''),price:(v:any)=>v==null?'':String(v),typeLabel:(v:any)=>String(v??''),table:(_:any,b:any)=>'<table>'+b+'</table>',select:()=>'',field:()=>'',val:()=>''};
    context.window.WealthApi={prices:async()=>prices,assets:async()=>assets,get:async()=>history,save:async()=>({updated:0,failed:0}),del:async()=>({})};
    context.window.WealthMarketPrices={renderCard:async()=>'<div>market</div>'};
    vm.createContext(context); vm.runInContext(fs.readFileSync('public/js/wealth/prices.js','utf8'),context);
    return context.window.WealthPrices.render();
  }
  it('renders without refresh runs',async()=>{ expect(await renderWith([])).toContain('Never'); });
  it('renders completed refresh run with plain-object provider counts and never calls .get on them',async()=>{
    const providers:any={nse_bhavcopy:2,yahoo_finance:1,get(){throw new Error('plain object .get must not be called')}};
    const html=await renderWith([{status:'completed',updated_count:2,skipped_count:0,failed_count:0,providers}]);
    expect(html).toContain('NSE bhavcopy: 2'); expect(html).toContain('Yahoo Finance: 1');
  });
  it('renders partial refresh run and legacy assets without provider fields',async()=>{
    const html=await renderWith([{status:'partially_completed',updated_count:1,skipped_count:0,failed_count:1,providers:{mfapi:1}}],[],[{id:1,name:'Legacy Fund'}]);
    expect(html).toContain('Failed: 1'); expect(html).toContain('Legacy Fund');
  });
  it('keeps prices usable when refresh-history API returns an error shape',async()=>{
    const context:any={console,document:{getElementById:()=>null},window:{}};
    context.window.WealthHelpers={esc:(v:any)=>String(v??''),price:(v:any)=>v==null?'':String(v),typeLabel:(v:any)=>String(v??''),table:(_:any,b:any)=>'<table>'+b+'</table>',select:()=>'',field:()=>'',val:()=>''};
    context.window.WealthApi={prices:async()=>[{id:1,asset_id:1,asset_name:'Coal',price:'10'}],assets:async()=>[],get:async()=>{throw Object.assign(new Error('API failed'),{data:{error:'bad'}})}};
    vm.createContext(context); vm.runInContext(fs.readFileSync('public/js/wealth/prices.js','utf8'),context);
    const html=await context.window.WealthPrices.render();
    expect(html).toContain('Refresh history unavailable'); expect(html).toContain('Coal');
  });
});

describe('wealth prices refresh button behaviour',()=>{
  function setup(saveImpl:any){
    const calls:any[]=[]; const docEls:any={wealthRefreshButton:{disabled:false,textContent:''}};
    const context:any={console,setTimeout,clearTimeout,AbortController,document:{getElementById:(id:string)=>docEls[id]||null},window:{}};
    context.window.WealthHelpers={esc:(v:any)=>String(v??''),price:(v:any)=>v==null?'':String(v),typeLabel:(v:any)=>String(v??''),table:(_:any,b:any)=>'<table>'+b+'</table>',select:()=>'',field:()=>'',val:()=>''};
    context.window.WealthApi={prices:async()=>[],assets:async()=>[],get:async()=>[],refreshPrices:async(body:any,opts:any)=>{calls.push({body,opts});return saveImpl(body,opts)},save:async()=>({}),del:async()=>({})};
    context.window.WealthMarketPrices={renderCard:async()=>''};
    context.window.toast=(m:string)=>{calls.push({toast:m})}; context.toast=context.window.toast; context.window.WealthRouter={load:(p:string)=>calls.push({load:p})}; context.WealthRouter=context.window.WealthRouter;
    vm.createContext(context); vm.runInContext(fs.readFileSync('public/js/wealth/prices.js','utf8'),context);
    return {context,calls,docEls};
  }
  it('click posts to refresh endpoint payload, enters loading, disables duplicate requests, and renders success counts',async()=>{
    let resolve:any; const pending=new Promise(r=>{resolve=r}); const s=setup(()=>pending);
    const p1=s.context.window.WealthPrices.refresh({preventDefault:()=>s.calls.push({prevented:true})});
    const p2=s.context.window.WealthPrices.refresh({preventDefault:()=>s.calls.push({prevented:true})});
    expect(s.docEls.wealthRefreshButton.disabled).toBe(true); expect(s.docEls.wealthRefreshButton.textContent).toContain('Refreshing'); expect(s.calls.filter(c=>c.body)).toHaveLength(1); expect(s.calls.find(c=>c.body).body).toEqual({scope:'google_sheets',force:false});
    resolve({batchId:1,status:'completed',requested:1,updated:1,unchanged:0,failed:0,results:[]}); await p1; await p2;
    expect(s.calls.some(c=>String(c.toast).includes('Refresh completed: 1 updated, 0 unchanged, 0 failed'))).toBe(true);
    expect(s.calls.some(c=>c.load==='prices')).toBe(true);
  });
  it('renders partial failures, api failure, cooldown, and zero-result messages',async()=>{
    const s=setup(async()=>({requested:0,updated:0,unchanged:0,failed:0,results:[]})); await s.context.window.WealthPrices.refresh({preventDefault:()=>{}}); expect(s.calls.some(c=>c.toast==='No assets are configured for automatic price refresh.')).toBe(true);
    const partial=s.context.window.WealthPrices._test.messageFor({requested:2,updated:1,unchanged:0,failed:1,status:'partially_completed'}); expect(partial).toContain('partially completed');
    const fail=setup(async()=>{throw new Error('server down')}); await fail.context.window.WealthPrices.refresh({preventDefault:()=>{}}); expect(fail.calls.some(c=>c.toast==='server down')).toBe(true);
    const cool=setup(async()=>{throw Object.assign(new Error('Manual refresh cooldown is active'),{status:429})}); await cool.context.window.WealthPrices.refresh({preventDefault:()=>{}}); expect(cool.calls.some(c=>String(c.toast).includes('Try again'))).toBe(true);
  });
});


describe('automatic refresh asset selection',()=>{
  it('selects configured HINDALCO and excludes disabled/manual assets',()=>{
    expect(isEligibleForAutomaticRefresh({id:1,user_id:1,asset_type:'stock',symbol:'HINDALCO',price_provider:'nse_bhavcopy',provider_symbol:'HINDALCO',provider_exchange:'NSE',automatic_price_refresh:1,is_active:1})).toBe(true);
    expect(isEligibleForAutomaticRefresh({id:2,user_id:1,asset_type:'stock',price_provider:'nse_bhavcopy',provider_symbol:'HINDALCO',automatic_price_refresh:0,is_active:1})).toBe(false);
    expect(isEligibleForAutomaticRefresh({id:3,user_id:1,asset_type:'stock',price_provider:'manual',automatic_price_refresh:1,is_active:1})).toBe(false);
  });
});
