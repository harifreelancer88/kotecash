import { formatDecimal, parseDecimal } from '../wealth/decimal';
import type { MarketDataProvider, QuoteOutcome, QuoteRequest, MarketDataErrorCode } from './types';
import { outcomeError, safeProviderError } from './types';

function providerSymbol(r: QuoteRequest) { const s = String(r.symbol || '').trim().toUpperCase(); const e = String(r.exchange || '').trim().toUpperCase(); if (!s) throw new Error('Missing symbol'); if (!['NSE','BSE'].includes(e)) throw new Error('Unsupported exchange'); return { symbol: s, exchange: e as 'NSE'|'BSE' }; }
function dateFrom(v: any) { const raw = String(v || new Date().toISOString()).slice(0, 19).replace(' ', 'T'); const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z'); return Number.isNaN(d.getTime()) ? new Date() : d; }
function tdCode(j:any, status:number):MarketDataErrorCode{ const m=String(j?.message||'').toLowerCase(); const c=String(j?.code||'').toLowerCase(); if(status===401||status===403||/api key|apikey|auth|unauthor|invalid key/.test(m+c)) return 'provider_authentication_failed'; if(status===429||/rate limit/.test(m)) return 'rate_limited'; if(/quota|credits|usage limit/.test(m)) return 'quota_exceeded'; if(/plan|subscription|access|permission|not available for your plan|exchange/.test(m)) return 'plan_access_restricted'; if(/symbol.*not.*found|not found|invalid symbol/.test(m)) return 'symbol_not_found'; if(status>=500) return 'provider_5xx'; return 'market_data_error'; }
function docFields(j:any){ return {provider_status:j?.status,provider_code:j?.code}; }
export class TwelveDataProvider implements MarketDataProvider {
  name = 'twelve_data';
  constructor(private apiKey: string, private baseUrl = 'https://api.twelvedata.com') {}
  async getQuote(request: QuoteRequest, signal?: AbortSignal): Promise<QuoteOutcome> {
    let id: ReturnType<typeof providerSymbol>;
    try { id = providerSymbol(request); } catch(e:any) { return outcomeError(request,'market_data_error',e.message,false); }
    try {
      const url = new URL('/quote', this.baseUrl); url.searchParams.set('symbol', id.symbol); url.searchParams.set('exchange', id.exchange); url.searchParams.set('apikey', this.apiKey);
      const res = await fetch(url.toString(), { signal });
      let j:any = null; try { j = await res.json(); } catch { if(!res.ok) return outcomeError(request,res.status>=500?'provider_5xx':'market_data_error',`Provider HTTP ${res.status}`,res.status>=500,res.status); return outcomeError(request,'malformed_provider_response','Malformed provider response',false,res.status); }
      if (!res.ok) { const code=tdCode(j,res.status); return outcomeError(request,code,String(j?.message||`Provider HTTP ${res.status}`),code==='rate_limited'||code==='provider_5xx',res.status,docFields(j)); }
      if (j?.status === 'error' || j?.code) { const code=tdCode(j,res.status); return outcomeError(request,code,String(j?.message||'Provider error'),code==='rate_limited'||code==='provider_5xx',res.status,docFields(j)); }
      const returnedSymbol = String(j.symbol || '').toUpperCase(); const returnedExchange = String(j.exchange || j.exchange_short || '').toUpperCase();
      if (returnedSymbol && returnedSymbol !== id.symbol) return outcomeError(request,'symbol_mismatch','Provider symbol mismatch');
      if (returnedExchange && !returnedExchange.includes(id.exchange)) return outcomeError(request,'symbol_mismatch','Provider exchange mismatch');
      const currency = String(j.currency || '').toUpperCase(); if (currency !== 'INR') return outcomeError(request,'currency_mismatch','Provider currency mismatch');
      const rawPrice = j.close ?? j.previous_close ?? j.price; if (rawPrice == null) return outcomeError(request,'malformed_provider_response','Provider missing price');
      const price = formatDecimal(parseDecimal(String(rawPrice), { allowZero:false })); const mt = dateFrom(j.datetime || j.timestamp);
      return { ok:true, request, quote:{ provider:this.name, provider_timestamp:new Date().toISOString(), market_timestamp:mt.toISOString(), currency:'INR', symbol:id.symbol, exchange:id.exchange, price, raw_status:String(j.status || 'ok'), data_kind:'delayed' } };
    } catch (e:any) { return outcomeError(request, e?.name === 'AbortError' ? 'timeout' : 'market_data_error', e?.name === 'AbortError' ? 'Provider timeout' : safeProviderError(e), e?.name === 'AbortError'); }
  }
  async getQuotes(requests: QuoteRequest[], signal?: AbortSignal) { return Promise.all(requests.map(r => this.getQuote(r, signal))); }
}
