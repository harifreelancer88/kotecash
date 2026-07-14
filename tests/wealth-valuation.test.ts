import { describe, expect, it, vi } from 'vitest';
import { getWealthAggregation } from '../src/server/wealth/valuation';

function db(rows: Record<string, any[]>) { return { prepare: vi.fn((q:string)=>({ bind: vi.fn(()=>({ all: vi.fn(async()=>({ results: Object.entries(rows).find(([k])=>q.includes(k))?.[1] || [] })) })) })) } as any; }
const accounts=[
  {id:1,name:'Broker',account_type:'brokerage',is_active:1,include_in_net_worth:1,valuation_mode:'holdings',value:0},
  {id:2,name:'Legacy',account_type:'other',is_active:1,include_in_net_worth:1,valuation_mode:'manual_snapshot',value:500},
  {id:3,name:'Hybrid',account_type:'other',is_active:0,include_in_net_worth:1,valuation_mode:'hybrid',value:9999},
  {id:4,name:'Excluded',account_type:'other',is_active:1,include_in_net_worth:0,valuation_mode:'manual_snapshot',value:700},
];

describe('wealth valuation service',()=>{
  it('values holdings, manual snapshots, hybrid without double counting, inactive and excluded accounts',async()=>{
    const agg=await getWealthAggregation(db({
      'FROM portfolios WHERE user_id=?':accounts,
      'FROM investment_transactions':[ {id:1,account_id:1,asset_id:10,transaction_type:'buy',trade_date:'2026-01-01',quantity:'2',gross_amount:200,asset_type:'stock',pricing_mode:'manual'}, {id:2,account_id:3,asset_id:11,transaction_type:'buy',trade_date:'2026-01-01',quantity:'3',gross_amount:300,asset_type:'mutual_fund',pricing_mode:'manual'} ],
      'FROM investment_prices':[ {asset_id:10,price_date:'2026-02-01',price:'150'}, {asset_id:11,price_date:'2026-02-01',price:'200'} ],
      'FROM balance_history':[ {entity_kind:'portfolio',entity_id:2,amount:600,recorded_at:'2026-02-01 00:00:00'}, {entity_kind:'portfolio',entity_id:3,amount:9000,recorded_at:'2026-02-01 00:00:00'}, {entity_kind:'portfolio',entity_id:4,amount:700,recorded_at:'2026-02-01 00:00:00'} ],
    }),1,'2026-02-28');
    expect(agg.total).toBe(900); // 2*150 + 600; inactive hybrid is excluded
    expect(agg.excluded_value).toBe(1300);
    expect(agg.account_count).toBe(2);
    expect(agg.assetBreakdown.stocks).toBe(300);
    expect(agg.assetBreakdown.mutual_funds).toBe(600);
    expect(agg.assetBreakdown.other).toBe(1300); // includes excluded reporting bucket
    expect(agg.accounts.find(a=>a.account_id===3)?.valuation_source).toBe('holdings');
  });
  it('never uses future prices and marks missing historical price incomplete',async()=>{
    const agg=await getWealthAggregation(db({
      'FROM portfolios WHERE user_id=?':[accounts[0]],
      'FROM investment_transactions':[ {id:1,account_id:1,asset_id:10,transaction_type:'buy',trade_date:'2026-01-01',quantity:'1',gross_amount:100,asset_type:'stock',pricing_mode:'manual'} ],
      'FROM investment_prices':[ {asset_id:10,price_date:'2026-03-01',price:'999'} ],
      'FROM balance_history':[],
    }),1,'2026-02-28');
    expect(agg.total).toBe(0);
    expect(agg.valuation_complete).toBe(false);
    expect(agg.warnings.join(',')).toContain('missing_price');
  });
  it('surfaces manual snapshot, formula, and legacy provenance without double counting',async()=>{
    const agg=await getWealthAggregation(db({
      'FROM portfolios WHERE user_id=?':[
        {id:10,name:'EPF legacy',account_type:'epf',is_active:1,include_in_net_worth:1,valuation_mode:'manual_snapshot',value:125000},
        {id:11,name:'EPF snap',account_type:'epf',is_active:1,include_in_net_worth:1,valuation_mode:'manual_snapshot',value:125000},
        {id:12,name:'FD',account_type:'fixed_deposit',is_active:1,include_in_net_worth:1,valuation_mode:'formula',value:0,metadata:JSON.stringify({principal:100000,interest_rate:7,start_date:'2026-04-01',maturity_date:'2027-04-01',compounding_frequency:'quarterly'})},
      ],
      'FROM balance_history':[{id:1,entity_kind:'portfolio',entity_id:10,amount:125000,recorded_at:'2026-07-01 00:00:00'},{id:2,entity_kind:'portfolio',entity_id:11,amount:125000,recorded_at:'2026-07-01 00:00:00'}],
      'FROM wealth_valuation_snapshots':[{id:99,user_id:1,account_id:11,asset_id:null,valuation_date:'2026-07-14',current_value:126000}],
    }),1,'2026-07-14');
    const legacy=agg.accounts.find(a=>a.account_id===10)!;
    const snap=agg.accounts.find(a=>a.account_id===11)!;
    const fd=agg.accounts.find(a=>a.account_id===12)!;
    expect(legacy.valuation_source).toBe('legacy_balance_history');
    expect(legacy.valuation_message).toContain('legacy balance value');
    expect(snap.valuation_source).toBe('manual_snapshot');
    expect(snap.value).toBe(126000);
    expect(fd.valuation_source).toBe('formula');
    expect(fd.value).toBeGreaterThan(100000);
    expect(agg.total).toBe(legacy.value+snap.value+fd.value);
  });
});
