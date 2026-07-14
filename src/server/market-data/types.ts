export type MarketDataKind = 'delayed' | 'realtime' | 'eod' | 'unknown';
export type QuoteRequest = { symbol: string; exchange: 'NSE' | 'BSE'; assetId?: number };
export type MarketQuote = { provider: string; provider_timestamp: string; market_timestamp: string; currency: string; symbol: string; exchange: string; price: string; raw_status?: string; data_kind: MarketDataKind };
export type QuoteOutcome = { ok: true; request: QuoteRequest; quote: MarketQuote } | { ok: false; request: QuoteRequest; error: string; retryable?: boolean };
export interface MarketDataProvider { name: string; getQuote(request: QuoteRequest, signal?: AbortSignal): Promise<QuoteOutcome>; getQuotes(requests: QuoteRequest[], signal?: AbortSignal): Promise<QuoteOutcome[]>; }
export class SafeMarketDataError extends Error { constructor(message: string, public code = 'market_data_error', public retryable = false) { super(message); } }
export function safeProviderError(err: unknown): string { const msg = err instanceof Error ? err.message : String(err || 'Provider error'); return msg.replace(/[A-Za-z0-9_\-]{16,}/g, '[redacted]'); }
