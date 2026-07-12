export const ACCOUNT_TYPES = [
  "brokerage",
  "mutual_fund_platform",
  "demat",
  "epf",
  "nps",
  "ppf",
  "ssy",
  "fixed_income",
  "other",
] as const;

export const VALUATION_MODES = ["holdings", "manual_snapshot", "hybrid"] as const;

export const ASSET_TYPES = [
  "stock",
  "mutual_fund",
  "etf",
  "epf",
  "nps",
  "ppf",
  "ssy",
  "bond",
  "fixed_income",
  "other",
] as const;

export const PRICE_SOURCES = ["manual", "market", "nav", "account_snapshot", "import"] as const;
export const PRICING_MODES = ["manual", "market", "not_priced", "account_level"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type ValuationMode = (typeof VALUATION_MODES)[number];
export type AssetType = (typeof ASSET_TYPES)[number];
export type PriceSource = (typeof PRICE_SOURCES)[number];
export type PricingMode = (typeof PRICING_MODES)[number];
