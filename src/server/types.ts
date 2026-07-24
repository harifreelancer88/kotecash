import type { Context } from "hono";

export type Bindings = {
  DB: D1Database;
  TWELVE_DATA_API_KEY?: string;
  MARKETSTACK_API_KEY?: string;
  MARKET_DATA_PROVIDER?: string;
  MARKET_DATA_TIMEOUT_MS?: string;
  MARKET_DATA_MAX_SYMBOLS_PER_REFRESH?: string;
  MARKET_DATA_STALE_HOURS?: string;
  PRICE_FEED_MODE?: string;
  GOOGLE_SHEETS_PRICE_FEED_URL?: string;
  GOOGLE_SHEETS_PRICE_FEED_TOKEN?: string;
  GOOGLE_SHEETS_PRICE_FEED_TIMEOUT_MS?: string;
};

export type Variables = {
  userId: number;
};

export type AppContext = Context<
  { Bindings: Bindings; Variables: Variables }
>;

export function userId(c: AppContext): number {
  return c.get("userId");
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
