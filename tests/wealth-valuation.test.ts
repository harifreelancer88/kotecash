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
    expect(agg.total).toBe(1500); // 2*150 + 600 + 3*200, not hybrid snapshot 9000
    expect(agg.excluded_value).toBe(700);
    expect(agg.account_count).toBe(3);
    expect(agg.assetBreakdown.stocks).toBe(300);
    expect(agg.assetBreakdown.mutual_funds).toBe(600);
    expect(agg.assetBreakdown.manual_portfolios).toBe(1300); // includes excluded reporting bucket
    expect(agg.accounts.find(a=>a.account_id===3)?.warnings).toContain('hybrid_manual_residual_unavailable_holdings_authoritative');
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
});
