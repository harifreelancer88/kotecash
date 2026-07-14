export const ACCOUNT_TYPES = [
  "brokerage",
  "mutual_fund",
  "epf",
  "nps",
  "ppf",
  "ssy",
  "fixed_deposit",
  "gold",
  "bond",
  "crypto",
  "other",
] as const;

export const VALUATION_MODES = ["holdings", "manual_snapshot", "formula", "hybrid"] as const;

export const ASSET_TYPES = [
  "stock",
  "mutual_fund",
  "epf",
  "nps",
  "ppf",
  "ssy",
  "fixed_deposit",
  "gold",
  "bond",
  "crypto",
  "cash_equivalent",
  "other",
] as const;

export const PRICE_SOURCES = ["manual", "market", "nav", "account_snapshot", "import"] as const;
export const PRICING_MODES = ["manual", "market", "not_priced", "account_level"] as const;
export const SNAPSHOT_SOURCES = ["manual", "import", "formula", "migration"] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type ValuationMode = (typeof VALUATION_MODES)[number];
export type AssetType = (typeof ASSET_TYPES)[number];
export type PriceSource = (typeof PRICE_SOURCES)[number];
export type PricingMode = (typeof PRICING_MODES)[number];
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];
