import type { AppContext } from '../types';
import { formatDecimal, parseDecimal } from './decimal';

export type PriceFeedMode = 'google_sheets' | 'legacy_direct';
export type FeedAssetType = 'stock' | 'etf' | 'mutual_fund' | 'mf' | 'ulip' | 'crypto' | 'other';
export type FeedRowStatus = 'accepted' | 'rejected';
export type GoogleSheetsFeedDiagnostics = {
  hostname?: string;
  httpStatus?: number;
  schemaVersion?: number;
  generatedAt?: string;
  rowsReceived: number;
  rowsAccepted: number;
  rowsRejected: number;
  warnings: string[];
};
export type NormalizedFeedPrice = {
  assetKey: string;
  rawAssetKey: string;
  assetType: FeedAssetType;
  symbol: string | null;
  exchange: string | null;
  price: string;
  currency: string;
  priceDate: string;
  capturedAt: string;
  underlyingSource: string | null;
};
export type RejectedFeedRow = { assetKey?: string; rowNumber: number; reason: string };
export type GoogleSheetsFeedPayload = {
  connected: boolean;
  schemaVersion?: number;
  generatedAt?: string;
  prices: NormalizedFeedPrice[];
  rejectedRows: RejectedFeedRow[];
  diagnostics: GoogleSheetsFeedDiagnostics;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const TOKEN_RE = /[A-Za-z0-9_\-]{24,}/g;
const supportedCurrencies = new Set(['INR']);
const staleDays: Record<string, number> = { stock: 3, etf: 3, mutual_fund: 5, mf: 5, crypto: 1, ulip: 7, other: 7 };

function cleanSecret(value: unknown) {
  const s = String(value ?? '').trim();
  return s && s !== '<LOCAL_SECRET>' ? s : '';
}
export function priceFeedMode(env: Record<string, unknown>): PriceFeedMode {
  return String(env.PRICE_FEED_MODE || 'legacy_direct').trim().toLowerCase() === 'google_sheets' ? 'google_sheets' : 'legacy_direct';
}
export function normalizeFeedAssetKey(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i <= 0 || i === raw.length - 1) return raw.toLowerCase();
  const prefix = raw.slice(0, i).trim().toLowerCase();
  const suffix = raw.slice(i + 1).trim();
  if (!prefix || !suffix) return null;
  const canonicalSuffix = ['stock', 'etf', 'crypto'].includes(prefix) ? suffix.toUpperCase() : suffix.toLowerCase();
  return `${prefix}:${canonicalSuffix}`;
}
function sanitizeReason(value: unknown) {
  return String(value instanceof Error ? value.message : value || 'Feed error')
    .replace(TOKEN_RE, '[redacted]')
    .slice(0, 240);
}
function isDateOnly(v: unknown) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function dateDaysAgo(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`).getTime();
  const now = Date.now();
  return Math.floor((now - d) / 86_400_000);
}
function isFutureBeyondTolerance(date: string) {
  const d = new Date(`${date}T00:00:00.000Z`).getTime();
  const tomorrowUtc = Date.now() + 36 * 3_600_000;
  return d > tomorrowUtc;
}
function validTimestamp(v: unknown) {
  if (typeof v !== 'string' || !v.trim()) return false;
  return Number.isFinite(new Date(v).getTime());
}
function normalizeAssetType(v: unknown): FeedAssetType | null {
  const t = String(v ?? '').trim().toLowerCase();
  if (['stock', 'etf', 'mutual_fund', 'mf', 'ulip', 'crypto', 'other'].includes(t)) return t as FeedAssetType;
  return null;
}
function normalizeRow(row: any, rowNumber: number): { price?: NormalizedFeedPrice; rejected?: RejectedFeedRow } {
  const assetKey = normalizeFeedAssetKey(row?.assetKey);
  if (!assetKey) return { rejected: { rowNumber, reason: 'assetKey is required' } };
  const assetType = normalizeAssetType(row?.assetType);
  if (!assetType) return { rejected: { rowNumber, assetKey, reason: 'assetType is unsupported' } };
  if (String(row?.status ?? '').trim().toLowerCase() !== 'ok') return { rejected: { rowNumber, assetKey, reason: 'status is not ok' } };
  let price: string;
  try { price = formatDecimal(parseDecimal(row?.price, { allowZero: false })); }
  catch { return { rejected: { rowNumber, assetKey, reason: 'price must be finite and greater than zero' } }; }
  const currency = String(row?.currency ?? '').trim().toUpperCase();
  if (!supportedCurrencies.has(currency)) return { rejected: { rowNumber, assetKey, reason: 'currency is unsupported' } };
  const priceDate = String(row?.priceDate ?? '').trim();
  if (!isDateOnly(priceDate)) return { rejected: { rowNumber, assetKey, reason: 'priceDate is invalid' } };
  if (isFutureBeyondTolerance(priceDate)) return { rejected: { rowNumber, assetKey, reason: 'priceDate is in the future' } };
  const capturedAt = String(row?.capturedAt ?? '').trim();
  if (!validTimestamp(capturedAt)) return { rejected: { rowNumber, assetKey, reason: 'capturedAt is invalid' } };
  const maxAge = staleDays[assetType] ?? staleDays.other;
  if (dateDaysAgo(priceDate) > maxAge) return { rejected: { rowNumber, assetKey, reason: 'price row is stale' } };
  return {
    price: {
      assetKey,
      rawAssetKey: String(row.assetKey),
      assetType,
      symbol: row?.symbol == null ? null : String(row.symbol).trim().toUpperCase() || null,
      exchange: row?.exchange == null ? null : String(row.exchange).trim().toUpperCase() || null,
      price,
      currency,
      priceDate,
      capturedAt,
      underlyingSource: row?.source == null ? null : String(row.source).trim().slice(0, 120) || null,
    },
  };
}
function dedupe(prices: NormalizedFeedPrice[], rejectedRows: RejectedFeedRow[]) {
  const seen = new Map<string, NormalizedFeedPrice>();
  const conflicts = new Set<string>();
  for (const p of prices) {
    const old = seen.get(p.assetKey);
    if (!old) { seen.set(p.assetKey, p); continue; }
    const same = old.price === p.price && old.currency === p.currency && old.priceDate === p.priceDate && old.capturedAt === p.capturedAt;
    if (!same) conflicts.add(p.assetKey);
  }
  for (const key of conflicts) rejectedRows.push({ assetKey: key, rowNumber: 0, reason: 'conflicting duplicate assetKey' });
  return [...seen.values()].filter(p => !conflicts.has(p.assetKey));
}
function config(env: Record<string, unknown>) {
  const feedUrl = cleanSecret(env.GOOGLE_SHEETS_PRICE_FEED_URL);
  const token = cleanSecret(env.GOOGLE_SHEETS_PRICE_FEED_TOKEN);
  if (!feedUrl || !token) throw new Error('Google Sheets feed credentials are not configured.');
  const url = new URL(feedUrl);
  if (url.hostname !== 'script.google.com' || !url.pathname.endsWith('/exec')) throw new Error('Google Sheets feed URL must be the Apps Script /exec URL.');
  url.search = '';
  url.searchParams.set('token', token);
  return { url, hostname: url.hostname };
}
async function fetchWithTimeout(fetcher: typeof fetch, url: URL, timeoutMs: number) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try { return await fetcher(url.toString(), { headers: { accept: 'application/json' }, redirect: 'follow', signal: ac.signal } as any); }
  finally { clearTimeout(timer); }
}
function transient(status: number) { return status === 429 || status >= 500; }
async function readJson(res: Response) {
  try { return await res.json(); }
  catch { throw new Error('Feed returned malformed JSON.'); }
}

export class GoogleSheetsPriceFeedProvider {
  constructor(private env: Record<string, unknown>, private fetcher: typeof fetch = fetch) {}
  async fetchFeed(): Promise<GoogleSheetsFeedPayload> {
    const cfg = config(this.env);
    const timeoutMs = Math.min(Math.max(Number(this.env.GOOGLE_SHEETS_PRICE_FEED_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 1000), DEFAULT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchWithTimeout(this.fetcher, cfg.url, timeoutMs);
      if (transient(res.status)) res = await fetchWithTimeout(this.fetcher, cfg.url, timeoutMs);
    } catch (e) {
      throw new Error(sanitizeReason(e).includes('abort') ? 'Google Sheets feed request timed out.' : sanitizeReason(e));
    }
    const diagnostics: GoogleSheetsFeedDiagnostics = { hostname: cfg.hostname, httpStatus: res.status, rowsReceived: 0, rowsAccepted: 0, rowsRejected: 0, warnings: [] };
    if (!res.ok) throw Object.assign(new Error(res.status === 401 || res.status === 403 ? 'Google Sheets feed authorization failed.' : `Google Sheets feed request failed (${res.status}).`), { diagnostics });
    const body: any = await readJson(res);
    diagnostics.schemaVersion = Number(body?.schemaVersion);
    diagnostics.generatedAt = typeof body?.generatedAt === 'string' ? body.generatedAt : undefined;
    if (diagnostics.schemaVersion !== 1) throw Object.assign(new Error('Google Sheets feed schema is unsupported.'), { diagnostics });
    if (!Array.isArray(body?.prices)) throw Object.assign(new Error('Google Sheets feed prices array is missing.'), { diagnostics });
    diagnostics.rowsReceived = body.prices.length;
    const accepted: NormalizedFeedPrice[] = [];
    const rejectedRows: RejectedFeedRow[] = [];
    body.prices.forEach((row: any, i: number) => {
      const out = normalizeRow(row, i + 1);
      if (out.price) accepted.push(out.price);
      if (out.rejected) rejectedRows.push(out.rejected);
    });
    const prices = dedupe(accepted, rejectedRows);
    diagnostics.rowsAccepted = prices.length;
    diagnostics.rowsRejected = rejectedRows.length;
    return { connected: true, schemaVersion: 1, generatedAt: diagnostics.generatedAt, prices, rejectedRows, diagnostics };
  }
}

export async function testGoogleSheetsFeed(c: AppContext) {
  const feed = await new GoogleSheetsPriceFeedProvider(c.env as any).fetchFeed();
  return {
    connected: true,
    schemaVersion: feed.schemaVersion,
    generatedAt: feed.generatedAt,
    rowsReceived: feed.diagnostics.rowsReceived,
    validRows: feed.diagnostics.rowsAccepted,
    invalidRows: feed.diagnostics.rowsRejected,
    diagnostics: {
      hostname: feed.diagnostics.hostname,
      httpStatus: feed.diagnostics.httpStatus,
      rowsReceived: feed.diagnostics.rowsReceived,
      rowsAccepted: feed.diagnostics.rowsAccepted,
      rowsRejected: feed.diagnostics.rowsRejected,
    },
  };
}
