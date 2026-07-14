import { formatDecimal, parseDecimal } from '../wealth/decimal';
import type { MarketDataProvider, QuoteOutcome, QuoteRequest, MarketDataErrorCode } from './types';
import { outcomeError, safeProviderError } from './types';

const EXCHANGE_MIC = { NSE: 'XNSE', BSE: 'XBOM' } as const;

function marketstackSymbol(r: QuoteRequest) {
  const symbol = String((r as any).providerSymbol || r.symbol || '').trim().toUpperCase();
  const exchange = String((r as any).providerExchange || r.exchange || '').trim().toUpperCase();
  if (!symbol) throw new Error('Missing symbol');
  if (!['NSE', 'BSE'].includes(exchange)) throw new Error('Unsupported exchange');
  return { symbol, exchange: exchange as 'NSE' | 'BSE', providerSymbol: `${symbol}.${EXCHANGE_MIC[exchange as 'NSE' | 'BSE']}` };
}
function msCode(j: any, status: number): MarketDataErrorCode {
  const msg = String(j?.error?.message || j?.message || '').toLowerCase();
  const code = String(j?.error?.code || j?.code || '').toLowerCase();
  if (status === 401 || status === 403 || /access_key|api key|auth|invalid/.test(msg + code)) return 'provider_authentication_failed';
  if (status === 429 || /rate/.test(msg + code)) return 'rate_limited';
  if (/limit|quota/.test(msg + code)) return 'quota_exceeded';
  if (/plan|subscription|access|permission/.test(msg + code)) return 'plan_access_restricted';
  if (/symbol|ticker/.test(msg + code) && /not|invalid|found/.test(msg + code)) return 'symbol_not_found';
  if (status >= 500) return 'provider_5xx';
  return 'market_data_error';
}
function parseDate(v: any) { return String(v || '').slice(0, 10); }
function isFuture(date: string) { return date > new Date().toISOString().slice(0, 10); }

export class MarketstackProvider implements MarketDataProvider {
  name = 'marketstack';
  constructor(private apiKey: string, private baseUrl = 'https://api.marketstack.com/v1') {}

  async getQuote(request: QuoteRequest, signal?: AbortSignal): Promise<QuoteOutcome> { return (await this.getQuotes([request], signal))[0]; }

  async getQuotes(requests: QuoteRequest[], signal?: AbortSignal): Promise<QuoteOutcome[]> {
    const resolved: { req: QuoteRequest; id?: ReturnType<typeof marketstackSymbol>; err?: QuoteOutcome }[] = requests.map(req => {
      try { return { req, id: marketstackSymbol(req) }; } catch (e: any) { return { req, err: outcomeError(req, 'market_data_error', e.message, false) }; }
    });
    const callable = resolved.filter(x => x.id) as { req: QuoteRequest; id: ReturnType<typeof marketstackSymbol> }[];
    const out = new Map<QuoteRequest, QuoteOutcome>();
    for (const r of resolved) if (r.err) out.set(r.req, r.err);
    if (!callable.length) return requests.map(r => out.get(r)!);
    try {
      const url = new URL('/eod/latest', this.baseUrl);
      url.searchParams.set('access_key', this.apiKey);
      url.searchParams.set('symbols', callable.map(x => x.id.providerSymbol).join(','));
      const res = await fetch(url.toString(), { signal });
      let j: any;
      try { j = await res.json(); } catch { return requests.map(r => out.get(r) || outcomeError(r, res.ok ? 'malformed_provider_response' : (res.status >= 500 ? 'provider_5xx' : 'market_data_error'), res.ok ? 'Malformed provider response' : `Provider HTTP ${res.status}`, res.status >= 500, res.status)); }
      if (!res.ok || j?.error) {
        const code = msCode(j, res.status);
        for (const x of callable) out.set(x.req, outcomeError(x.req, code, String(j?.error?.message || j?.message || `Provider HTTP ${res.status}`), code === 'rate_limited' || code === 'provider_5xx', res.status, { provider_code: j?.error?.code || j?.code }));
        return requests.map(r => out.get(r)!);
      }
      const rows = Array.isArray(j?.data) ? j.data : [];
      const bySymbol = new Map(rows.map((row: any) => [String(row.symbol || '').toUpperCase(), row]));
      for (const x of callable) {
        const row: any = bySymbol.get(x.id.providerSymbol) || bySymbol.get(x.id.symbol);
        if (!row) { out.set(x.req, outcomeError(x.req, 'symbol_not_found', 'Provider returned no EOD result')); continue; }
        const priceDate = parseDate(row.date); if (!priceDate) { out.set(x.req, outcomeError(x.req, 'malformed_provider_response', 'Provider missing price date')); continue; }
        if (isFuture(priceDate)) { out.set(x.req, outcomeError(x.req, 'malformed_provider_response', 'Provider returned future EOD date')); continue; }
        const currency = String(row.currency || 'INR').toUpperCase(); if (currency !== 'INR') { out.set(x.req, outcomeError(x.req, 'currency_mismatch', 'Provider currency mismatch')); continue; }
        try {
          const price = formatDecimal(parseDecimal(String(row.close ?? ''), { allowZero: false }));
          out.set(x.req, { ok: true, request: x.req, quote: { provider: this.name, provider_timestamp: new Date().toISOString(), market_timestamp: `${priceDate}T00:00:00.000Z`, currency, symbol: x.id.symbol, exchange: x.id.exchange, price, raw_status: 'ok', data_kind: 'eod' } });
        } catch { out.set(x.req, outcomeError(x.req, 'malformed_provider_response', 'Provider missing closing price')); }
      }
      return requests.map(r => out.get(r)!);
    } catch (e: any) { return requests.map(r => out.get(r) || outcomeError(r, e?.name === 'AbortError' ? 'timeout' : 'market_data_error', e?.name === 'AbortError' ? 'Provider timeout' : safeProviderError(e), e?.name === 'AbortError')); }
  }
}
