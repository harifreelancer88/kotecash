export type IndianPriceProvider = 'manual'|'nse_bhavcopy'|'yahoo_finance'|'mfapi';
export type MarketSourceType = 'official_close'|'yahoo_market_price'|'yahoo_daily_close'|'mutual_fund_nav';
export type MarketPrice = { assetId?:number; symbol:string; exchange?:string; close:string; currency:'INR'; tradeDate:string; providerTimestamp?:string; series?:string; provider:IndianPriceProvider; sourceType:MarketSourceType; providerSymbol?:string };
export type ProviderStatus = 'ok'|'not_yet_published'|'unavailable'|'no_new_data';
export type ProviderResult = { status:ProviderStatus; prices:MarketPrice[]; error?:string; retryable?:boolean; providerError?:unknown };
export interface MarketDataProvider { name:IndianPriceProvider; fetchPrices(args:{targetDate:string; assets:any[]; signal?:AbortSignal; force?:boolean}):Promise<ProviderResult>; }
export const sanitizeProviderError=(e:unknown)=>String(e instanceof Error?e.message:e||'Provider error').replace(/<[^>]{0,200}>/g,'').replace(/[A-Za-z0-9_\-]{32,}/g,'[redacted]').slice(0,240);
