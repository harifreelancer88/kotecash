import type { Bindings } from '../types';
import type { MarketDataProvider } from './types';
import { TwelveDataProvider } from './twelve-data';
export function marketProviderName(env: Bindings) { return (env.MARKET_DATA_PROVIDER || 'twelve_data').toLowerCase(); }
export function getMarketDataProvider(env: Bindings): { provider?: MarketDataProvider; error?: string; configured: boolean } { const name=marketProviderName(env); if(name !== 'twelve_data') return { configured:false, error:'Unsupported market data provider' }; if(!env.TWELVE_DATA_API_KEY) return { configured:false, error:'Market data provider is not configured' }; return { configured:true, provider:new TwelveDataProvider(env.TWELVE_DATA_API_KEY) }; }
export const marketConfig = (env: Bindings) => ({ timeoutMs:Number(env.MARKET_DATA_TIMEOUT_MS || 15000), maxSymbols:Number(env.MARKET_DATA_MAX_SYMBOLS_PER_REFRESH || 50), staleHours:Number(env.MARKET_DATA_STALE_HOURS || 36) });
