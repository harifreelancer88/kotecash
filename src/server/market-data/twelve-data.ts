import { formatDecimal, parseDecimal } from '../wealth/decimal';
import type { MarketDataProvider, QuoteOutcome, QuoteRequest } from './types';
import { safeProviderError } from './types';

function providerSymbol(r: QuoteRequest) { const s = String(r.symbol || '').trim().toUpperCase(); const e = String(r.exchange || '').trim().toUpperCase(); if (!s) throw new Error('Missing symbol'); if (!['NSE','BSE'].includes(e)) throw new Error('Unsupported exchange'); return { symbol: s, exchange: e as 'NSE'|'BSE' }; }
function dateFrom(v: any) { const raw = String(v || new Date().toISOString()).slice(0, 19).replace(' ', 'T'); const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z'); return Number.isNaN(d.getTime()) ? new Date() : d; }
export class TwelveDataProvider implements MarketDataProvider {
  name = 'twelve_data';
  constructor(private apiKey: string, private baseUrl = 'https://api.twelvedata.com') {}
  async getQuote(request: QuoteRequest, signal?: AbortSignal): Promise<QuoteOutcome> {
    try {
      const id = providerSymbol(request); const url = new URL('/quote', this.baseUrl); url.searchParams.set('symbol', id.symbol); url.searchParams.set('exchange', id.exchange); url.searchParams.set('apikey', this.apiKey);
      const res = await fetch(url.toString(), { signal });
      if (!res.ok) return { ok:false, request, error: res.status === 429 ? 'Provider rate limit' : `Provider HTTP ${res.status}`, retryable: res.status >= 500 };
      let j:any; try { j = await res.json(); } catch { return { ok:false, request, error:'Invalid provider JSON' }; }
      if (j?.status === 'error' || j?.code) return { ok:false, request, error: String(j?.message || 'Provider error'), retryable:false };
      const returnedSymbol = String(j.symbol || '').toUpperCase(); const returnedExchange = String(j.exchange || j.exchange_short || '').toUpperCase();
      if (returnedSymbol && returnedSymbol !== id.symbol) return { ok:false, request, error:'Provider symbol mismatch' };
      if (returnedExchange && !returnedExchange.includes(id.exchange)) return { ok:false, request, error:'Provider exchange mismatch' };
      const currency = String(j.currency || '').toUpperCase(); if (currency !== 'INR') return { ok:false, request, error:'Provider currency mismatch' };
      const rawPrice = j.close ?? j.previous_close ?? j.price; if (rawPrice == null) return { ok:false, request, error:'Provider missing price' };
      const price = formatDecimal(parseDecimal(String(rawPrice), { allowZero:false })); const mt = dateFrom(j.datetime || j.timestamp);
      return { ok:true, request, quote:{ provider:this.name, provider_timestamp:new Date().toISOString(), market_timestamp:mt.toISOString(), currency:'INR', symbol:id.symbol, exchange:id.exchange, price, raw_status:String(j.status || 'ok'), data_kind:'delayed' } };
    } catch (e:any) { return { ok:false, request, error: e?.name === 'AbortError' ? 'Provider timeout' : safeProviderError(e), retryable: e?.name === 'AbortError' }; }
  }
  async getQuotes(requests: QuoteRequest[], signal?: AbortSignal) { return Promise.all(requests.map(r => this.getQuote(r, signal))); }
}
