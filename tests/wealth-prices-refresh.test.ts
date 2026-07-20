import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import { normalizeProviderCounts, normalizeRefreshResults, refreshHistory } from '../src/server/wealth/indian-market-refresh';

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
    expect(html).toContain('partially_completed'); expect(html).toContain('Legacy Fund');
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
