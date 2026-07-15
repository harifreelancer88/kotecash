# Personal Wealth Architecture

## 1. Executive summary

Personal Wealth should be implemented as a backend-authoritative wealth layer that preserves KoteCash's existing movement-ledger model. Cash moving between wallets, deposits, credit cards, loans, and investment accounts remains a `movement`. Security purchases, sales, contributions, dividends, splits, bonuses, and valuation events are modeled as investment-domain records, not as ordinary expenses.

The recommended architecture is:

- Keep `movements` as the only ledger for actual money flows.
- Extend `portfolios` into broader investment accounts instead of replacing them immediately.
- Add normalized investment assets, investment transactions, prices, import batches, and optional holding snapshots.
- Keep market appreciation, depreciation, splits, bonuses, and price corrections out of `movements`.
- Calculate holdings, cost basis, gains, XIRR, and net worth on the backend through tested TypeScript formulas.
- Let `public/app.js` display API results and collect inputs; do not duplicate formulas in browser code.
- Reuse `deposits` for fixed deposits, but model EPF, NPS, PPF, and SSY as investment/retirement accounts with balance history and contributions.
- Add a future normalized liabilities model, while preserving current `credit_cards` and `cicilan` behavior until migration is justified.

This gives KoteCash a personal wealth module without turning it into a multi-tenant brokerage platform, advisory product, tax filing system, or live market terminal.

## 2. Domain boundaries

### Money movements

Money movements are actual cash flows with a date, positive amount, and optional source/destination endpoints. They belong in `movements` only when money enters, leaves, or moves inside the user's financial universe.

Examples:

- Salary received from outside into a bank wallet.
- Bank transfer to a brokerage account.
- Brokerage redemption proceeds back to a wallet.
- Loan EMI paid from a wallet to a liability.
- Credit-card payment from a wallet to a card.
- Dividend cash deposited into a bank account.

Do not put market appreciation, unrealised gain, stock splits, bonus units, price snapshots, or holding balances into `movements`.

### Investment transactions

Investment transactions describe what happened to an investment asset inside an investment account. They belong in a separate `investment_transactions` table and may optionally reference a movement when cash actually moved.

Examples:

- Buy 10 shares of a stock.
- Sell 5 units of a mutual fund.
- Monthly SIP purchase.
- Dividend declared or received.
- EPF employee contribution.
- Stock split or bonus issue.
- Fund charges deducted from account cash or units.

Investment transactions are not normal expenses. A stock purchase is a conversion from cash to an asset, not spending.

### Holdings

Holdings are derived positions: current quantity, cost basis, current value, realised gain, and unrealised gain. Holdings should normally be computed from investment transactions plus latest prices. They may be cached for performance, but the transaction ledger is the source of truth.

Do not store holdings as the only authoritative record unless they are explicit manual-balance assets whose historical transactions are unknown.

### Market valuations

Market valuations are asset prices, NAVs, or manually entered values. They belong in an `investment_prices` table, not in movements. Existing `balance_history` can continue to represent account/entity-level snapshots, especially for legacy portfolios and deposits, but instrument-level pricing needs its own model.

### Income from investments

Investment income has two parts:

- Investment-domain record: dividend, interest, coupon, maturity, or distribution in `investment_transactions`.
- Cash-flow record: a movement only if cash entered, left, or transferred between endpoints.

A dividend reinvested into the same asset may require only investment transactions. A dividend paid to a bank wallet requires both an investment transaction and a movement from outside or investment account to the wallet.

### Liabilities

Liabilities are obligations owed by the user: credit cards, personal loans, home loans, vehicle loans, education loans, and other debt. Current `credit_cards` and `cicilan` already model two liability types. A future `liabilities` table should generalize loans while preserving existing behavior.

Principal repayments reduce liability. Interest expense leaves the system and should be classified as expense when actually paid or charged.

### Net-worth snapshots

Net-worth snapshots are dated summaries of assets, liabilities, and net worth. They are reporting artifacts, not ledgers. Snapshots should be reconstructable from wallets, deposits, investment holdings/prices, liabilities, credit cards, cicilan, and historical prices. Locked snapshots may preserve month-end reports after reconciliation.

## 3. Existing model reuse

| Existing model | Decision | Rationale |
| --- | --- | --- |
| `portfolios` | Extend, then gradually generalize | It already represents investment accounts whose value changes through snapshots. Add account metadata and keep compatibility columns. |
| `deposits` | Reuse as-is initially; extend only for fixed-deposit-specific needs | Fixed deposits already have principal, rate, tenor, maturity, withdrawal behavior, and value display. Avoid duplicating them in investments. |
| `movements` | Reuse unchanged as canonical cash ledger | It remains the source of truth for actual cash flows. Do not overload it with market or holding events. |
| `balance_history` | Leave for entity snapshots; do not use for instrument prices | It is useful for portfolio/deposit/card snapshots but too generic for asset-level prices, NAVs, source metadata, and corrections. |
| `net_worth_snapshots` | Extend/generalize in a future migration | Add breakdown JSON, snapshot status, locking, and source metadata rather than replacing immediately. |
| `credit_cards` | Leave unchanged initially; integrate into future liabilities reporting | It is an existing liability endpoint with charge/payment semantics. Fix balance mismatch before deep Wealth integration. |
| `cicilan` | Preserve now; migrate later into generalized liabilities if needed | It works for installments but is not broad enough for all loans. Avoid a risky migration in early Wealth phases. |
| `categories` | Leave unchanged | Categories classify P&L movements. They should not classify market gains or investment purchases as expenses. |
| `wallets` | Leave unchanged | Wallets remain liquid cash endpoints used to fund investments and receive proceeds. |

## 4. Investment account model

The existing `portfolios` table should become the investment-account table over time. A new `investment_accounts` table would duplicate too much and force immediate migration of current portfolio snapshots. The safer path is to extend `portfolios` with account fields while preserving `name`, `value`, `updated_at`, and `last_snapshot_at` for compatibility.

Recommended future columns for `portfolios`:

| Column | Type | Purpose |
| --- | --- | --- |
| `account_type` | TEXT NOT NULL DEFAULT `'other'` | `brokerage`, `mutual_fund_platform`, `demat`, `epf`, `nps`, `ppf`, `ssy`, `fixed_income`, `other`. |
| `institution` | TEXT | Broker, AMC platform, employer, post office, bank, or provider. |
| `account_number_masked` | TEXT | Optional masked account reference. Never store full secrets unnecessarily. |
| `currency` | TEXT NOT NULL DEFAULT `'IDR'` | Account display currency; initial implementation may still support only one reporting currency. |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | Soft lifecycle state. |
| `opened_at` | TEXT | Account opening date. |
| `closed_at` | TEXT | Account closure date. Required when inactive because closed. |
| `include_in_net_worth` | INTEGER NOT NULL DEFAULT 1 | Allows tracking accounts excluded from net worth. |
| `valuation_mode` | TEXT NOT NULL DEFAULT `'holdings'` | `holdings`, `manual_snapshot`, or `hybrid`. |
| `notes` | TEXT | User notes. |

Constraints and lifecycle rules:

- `account_type` must be one of the defined enum values.
- `currency` should be a 3-letter uppercase code.
- Names should be unique per user among active accounts when practical: `(user_id, lower(name))` via application validation because SQLite expression uniqueness in D1 should be introduced carefully.
- Inactive accounts cannot receive new buy/contribution transactions unless explicitly reopening.
- Closed accounts can still appear in historical reports.
- Deleting an account with investment transactions should be blocked; use inactive instead.
- `valuation_mode='manual_snapshot'` means account value comes from `balance_history` rather than holdings. This supports legacy portfolios and manual retirement balances.

## 5. Investment asset model

Add an `investment_assets` table for instruments. Assets should be user-scoped to keep private manual assets simple and to avoid needing a global security master.

Proposed columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | Asset ID. |
| `user_id` | INTEGER NOT NULL | Owner. |
| `asset_type` | TEXT NOT NULL | `stock`, `mutual_fund`, `etf`, `epf`, `nps`, `ppf`, `ssy`, `bond`, `fixed_income`, `other`. |
| `name` | TEXT NOT NULL | Display name. |
| `symbol` | TEXT | Ticker or local symbol. |
| `isin` | TEXT | ISIN where available. |
| `exchange` | TEXT | NSE, BSE, NASDAQ, IDX, etc. |
| `scheme_code` | TEXT | Mutual fund scheme code. |
| `currency` | TEXT NOT NULL DEFAULT `'IDR'` | Pricing currency. |
| `price_source` | TEXT NOT NULL DEFAULT `'manual'` | `manual`, `market`, `nav`, `account_snapshot`, `import`. |
| `pricing_mode` | TEXT NOT NULL DEFAULT `'manual'` | `manual`, `market`, `not_priced`, `account_level`. |
| `is_active` | INTEGER NOT NULL DEFAULT 1 | Allows old instruments to remain historical. |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | Audit. |
| `updated_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | Audit. |
| `notes` | TEXT | Notes. |

Account ownership is represented by transactions and derived holdings. Do not permanently assign an asset to only one account; the same stock or fund may be held in multiple accounts. If account-specific instrument aliases are needed, add `investment_account_asset_aliases` later.

Recommended constraints:

- `(user_id, asset_type, symbol, exchange)` unique when symbol/exchange are present.
- `(user_id, isin)` unique when ISIN is present, unless multiple assets legitimately share ISIN through plans; handle in validation first if partial indexes are not preferred.
- `(user_id, scheme_code)` unique for mutual funds when present.
- `asset_type`, `currency`, `price_source`, and `pricing_mode` enum validation in backend routes.
- Manual/account-level priced assets may omit `symbol`, `isin`, and `exchange`.
- Market-priced stocks/ETFs should have `symbol` and preferably `exchange`.
- Mutual funds should have either `scheme_code`, `isin`, or a clear name.

## 6. Investment transaction model

Add `investment_transactions` as the authoritative investment event ledger. It must be separate from `movements` and optionally link to one movement.

Proposed columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | Transaction ID. |
| `user_id` | INTEGER NOT NULL | Owner. |
| `account_id` | INTEGER NOT NULL | References `portfolios.id` after portfolios are generalized. |
| `asset_id` | INTEGER | References `investment_assets.id`; nullable for account-level cash charges or manual account valuations. |
| `transaction_type` | TEXT NOT NULL | Enumerated type. |
| `trade_date` | TEXT NOT NULL | Economic date, `YYYY-MM-DD`. |
| `settlement_date` | TEXT | Optional settlement date. |
| `quantity` | TEXT | Decimal quantity as string to avoid floating precision loss. |
| `unit_price` | TEXT | Decimal price as string. |
| `gross_amount` | INTEGER | Minor currency units; positive. |
| `charges` | INTEGER NOT NULL DEFAULT 0 | Brokerage, fees, stamp duty, exit load, etc. |
| `taxes` | INTEGER NOT NULL DEFAULT 0 | Tax components paid as part of transaction. |
| `net_amount` | INTEGER | Positive cash impact amount. |
| `movement_id` | INTEGER | Optional linked movement. |
| `import_batch_id` | INTEGER | Optional import batch. |
| `external_ref` | TEXT | Broker/order/folio reference. |
| `notes` | TEXT | User note. |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | Audit. |
| `updated_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | Audit. |

Supported `transaction_type` values:

- `buy`
- `sell`
- `sip`
- `redemption`
- `dividend`
- `interest`
- `contribution`
- `withdrawal`
- `transfer_in`
- `transfer_out`
- `bonus`
- `split`
- `charges`
- `maturity`

Required fields by type:

| Type | Required fields | Notes |
| --- | --- | --- |
| `buy` | account, asset, date, quantity, unit price or gross amount, net amount | Increases quantity and cost basis. |
| `sip` | account, asset, date, quantity, unit price or gross amount, net amount | Same accounting as buy, marked as recurring/import-friendly. |
| `sell` | account, asset, date, quantity, unit price or gross amount, net amount | Decreases quantity and realizes gain/loss. |
| `redemption` | account, asset, date, quantity or full-redemption flag, net amount | Same as sell for funds. |
| `dividend` | account, asset, date, gross or net amount | Quantity usually unchanged unless reinvested through a paired buy. |
| `interest` | account, asset optional, date, amount | For bonds, EPF/PPF interest, cash interest, FD interest if modeled here. |
| `contribution` | account, asset optional, date, amount, quantity optional | Retirement and fixed-income contributions. |
| `withdrawal` | account, asset optional, date, amount, quantity optional | Reduces balance/units when applicable. |
| `transfer_in` | account, asset, date, quantity | No realised gain; cost basis may require provided cost. |
| `transfer_out` | account, asset, date, quantity | No sale proceeds unless also a movement. |
| `bonus` | account, asset, date, quantity | Increases quantity with zero cost. |
| `split` | account, asset, date, split ratio | Quantity changes; total cost unchanged. Use quantity fields or a `metadata_json` later. |
| `charges` | account, date, amount | May have asset if asset-specific. May link to a movement if paid from wallet. |
| `maturity` | account, asset optional, date, amount | Closes fixed-income/retirement instrument or deposit-like asset. |

A `metadata_json` column can be added if split ratios, tax lots, or broker-specific details become hard to express. Keep Phase 1 schema minimal if not needed.

## 7. Relationship with movements

The rule is simple: create a movement only for actual cash flow. Create an investment transaction only for investment-domain activity. Link them when both describe the same event from different perspectives.

| Scenario | Movement? | Investment transaction? | Example |
| --- | --- | --- | --- |
| Bank transfer to Zerodha | Yes | Optional account cash transaction later | `wallet -> portfolio` movement for cash funding. No holding changes. |
| Stock purchase using broker cash | No, if cash already sits in portfolio | Yes | `buy` transaction increases shares and cost basis. It is not an expense. |
| Stock purchase paid directly from bank | Yes | Yes | `wallet -> portfolio` movement plus linked `buy`. Net worth unchanged except charges/taxes if treated as costs. |
| Mutual fund SIP from bank | Yes | Yes | Monthly `wallet -> portfolio` movement linked to `sip` units allotted. |
| Stock sale with proceeds staying at broker | No | Yes | `sell` transaction realizes gain and increases account cash internally, if account cash is tracked. |
| Stock sale with proceeds to bank | Yes | Yes | `sell` transaction plus `portfolio -> wallet` movement for redemption proceeds. |
| Mutual fund redemption to bank | Yes | Yes | `redemption` plus movement from investment account to wallet. |
| Dividend received in bank | Yes | Yes | `dividend` transaction plus `outside` or `portfolio -> wallet` movement. It is investment income, not sale proceeds. |
| Dividend reinvested | No external cash movement | Yes, often `dividend` plus `buy` | Income and reinvestment remain investment-domain events. |
| EPF contribution from salary | Yes if salary cash flow is represented net/gross | Yes | Employee contribution may be a `wallet/outside -> portfolio` movement plus `contribution`; employer contribution may be investment transaction and optional income movement depending reporting preference. |
| FD maturity into bank | Yes | Usually no if using `deposits`; yes if modeled as fixed-income asset | Deposit withdrawal movement plus interest income movement; or `maturity` transaction for investment-mode fixed income. |
| Investment charges paid from wallet | Yes | Yes | `wallet -> outside` expense movement for fees plus `charges` transaction linked for cost basis/reporting. |
| Price update/NAV update | No | No | Create `investment_prices` row only. |
| Unrealised gain/loss | No | No | Derived from holdings and prices. |

Double-counting prevention:

- Net worth should count current holding/account value once, not both broker cash transfers and portfolio snapshots.
- P&L should include realised investment income/gains only through investment reports, not as normal expense categories unless cash actually leaves to outside as fees/taxes.
- A linked movement's amount should not be added to invested amount if the investment transaction already has `net_amount`; use the transaction as the investment source and the movement as cash-flow reconciliation.
- Portfolio cash transfers affect wallet and account cash, but should not by themselves change total net worth.

## 8. Holdings calculation engine

Backend formulas should compute holdings from `investment_transactions` and latest applicable prices.

Required outputs:

- `currentQuantity`: sum of quantity-changing transactions adjusted by splits and bonuses.
- `investedAmount`: cumulative net invested capital still attributable to open lots, plus optionally total contributed for reporting.
- `averageCost`: remaining cost basis divided by current quantity.
- `fifoCostBasis`: lot-by-lot remaining cost using FIFO for sells/redemptions.
- `realisedGain`: sale proceeds minus FIFO cost basis and sale charges/taxes according to chosen convention.
- `unrealisedGain`: current value minus remaining cost basis.
- `currentValue`: current quantity multiplied by latest price, or account-level manual value.
- `absoluteReturn`: realised gain plus unrealised gain plus income received minus charges where not capitalized.
- `totalReturn`: absolute return divided by invested capital, with safe handling for zero denominator.

Calculation strategy:

- Perform calculations dynamically for asset/account detail pages and tests.
- Cache or materialize only summary rows if performance becomes a problem with large imports.
- A future `investment_holding_snapshots` table can store month-end derived values for reports, but transactions and prices remain authoritative.
- Use backend route helpers such as `src/server/wealth/formulas.ts` or additions to `src/server/formulas.ts`; keep formulas pure and unit-tested.

Rounding and precision:

- Store money in integer whole currency units for compatibility with existing KoteCash integer IDR storage; INR Wealth integer amounts follow the same whole-unit convention.
- Store quantities and unit prices as decimal strings in the database, parse with deterministic decimal helpers in TypeScript.
- Avoid JavaScript floating point for persisted decimal math where precision matters. If no dependency is introduced, use scaled integers with asset-specific precision.
- Recommended default precision: quantity scale 1e6, unit price scale 1e6, money integer whole currency units.
- Round displayed money to whole IDR for current conventions.
- Round displayed quantities based on asset type: stocks 0-4 decimals, mutual funds 3-6 decimals, retirement units according to provider data.

## 9. XIRR design

XIRR should be calculated on the backend for:

- Individual asset.
- Investment account.
- Asset class.
- Complete investment portfolio.

Cash-flow sign convention from investor perspective:

- Investments/contributions/buys/SIPs: negative cash flow.
- Sales/redemptions/withdrawals/dividends/interest/maturity proceeds: positive cash flow.
- Current value for open positions: positive terminal cash flow at valuation date.
- Charges/taxes paid separately: negative cash flow unless already included in net investment amount.

Rules:

- Open investments include a terminal positive cash flow equal to current value on the valuation date.
- Fully sold investments do not include a terminal value unless residual cash or unsettled proceeds remain.
- Dividends and interest are positive flows on their received dates.
- Invalid sets with all positive flows, all negative flows, fewer than two dated flows, or no sign change should return `null` plus a reason.
- Same-day multiple flows should be combined before solving.
- Display fallback should be `—` or `Not enough cash flows`, not `0%`.

Algorithm recommendation:

- Implement a tested TypeScript function using Newton-Raphson with bisection fallback.
- Rate bounds: start with `[-0.999999, 10]`; expand upper bound if needed up to a safe cap.
- Use actual day count: `(date - firstDate) / 365`.
- Convergence tolerance: NPV absolute value below 0.01 currency unit or rate delta below `1e-7`.
- Max iterations: 100 Newton steps plus 200 bisection steps.
- Reject rates at or below `-1`.
- Return `{ value, method, iterations }` internally for tests; API can return `{ xirr, status, reason }`.

This is suitable for Cloudflare Workers because it is CPU-light, deterministic, and dependency-free.

## 10. Price-history model

Create `investment_prices` rather than extending `balance_history` for instrument prices.

Reasoning:

- `balance_history` stores generic entity snapshots by `entity_kind` and `entity_id`.
- Instrument prices need asset ID, price date, source, currency, duplicate handling, stale detection, and correction audit.
- Month-end reconstruction needs daily price lookup by asset, not only account snapshots.
- Keeping price rows separate avoids changing current deposit/card/portfolio snapshot semantics.

Proposed columns:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | Price row. |
| `user_id` | INTEGER NOT NULL | Owner. |
| `asset_id` | INTEGER NOT NULL | Instrument. |
| `price_date` | TEXT NOT NULL | `YYYY-MM-DD`. |
| `price` | TEXT NOT NULL | Decimal price/NAV. |
| `currency` | TEXT NOT NULL | Currency. |
| `source` | TEXT NOT NULL | `manual`, `import`, `market`, `nav`, `snapshot`. |
| `is_corrected` | INTEGER NOT NULL DEFAULT 0 | Marks superseded/corrected row if retaining history. |
| `created_at` | TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP | Audit. |
| `notes` | TEXT | Correction/source note. |

Rules:

- Unique active price per `(user_id, asset_id, price_date, source)` or stricter `(user_id, asset_id, price_date)` if corrections update/replace rows.
- Prefer upsert for manual corrections while recording audit in import/history metadata.
- Stale price detection should compare latest price date to current date by asset type: stocks > 7 calendar days, mutual funds > 7 days, manual assets > 35 days by default.
- Month-end reconstruction uses the latest price on or before month end.
- If no historical price exists for a month, use account-level `balance_history` only for manual-snapshot accounts or mark historical value as incomplete.

## 11. Fixed deposits and retirement accounts

### Fixed deposits

Fixed deposits should continue using `deposits` initially. They already support principal, rate, tenor, maturity date, status, withdrawal movements, interest display, and balance history. Do not duplicate them as investment assets unless future fixed-income holdings need tradable bonds, multiple coupons, or secondary-market prices.

Modeling:

- Contributions/opening principal: existing deposit creation and optional wallet-to-deposit movement.
- Current balance: base amount plus movements, with maturity-value display.
- Interest/growth: computed for display or recorded as income movement when paid.
- Maturity date/value: existing fields and formula.
- Manual balance updates: `balance_history` snapshot for deposit.
- Valuation history: keep using `balance_history`.

### EPF

Model as an investment account with `account_type='epf'` and an EPF asset using account-level/manual pricing. Contributions are investment transactions and may link to salary/payroll movements. Interest is an `interest` transaction or manual balance snapshot if only annual statements are available.

### NPS

Model as an investment account with `account_type='nps'`. NPS can hold scheme assets if unit/NAV details are available; otherwise use manual account-level snapshots. Contributions are transactions, current balance comes from holdings or balance history, and growth is price/snapshot-driven.

### PPF

Model as an investment account with `account_type='ppf'` and account-level asset. Contributions are `contribution` transactions; annual interest can be `interest`; balance can be updated manually from statements. Include maturity date where useful through account metadata or a later retirement-account details table.

### SSY

Model like PPF with `account_type='ssy'`. Contributions and interest are investment transactions; current value can be manual balance snapshots. Include beneficiary/account notes without building a multi-user platform.

## 12. Loans and liabilities

Future liabilities should use a new `liabilities` table while preserving `credit_cards` and `cicilan` for backward compatibility. Do not force an early migration of existing debt screens.

Recommended approach:

- Preserve `credit_cards` as the revolving-credit model.
- Preserve `cicilan` for existing installment debts.
- Add `liabilities` later for home loans, personal loans, vehicle loans, education loans, and other liabilities.
- Optionally migrate `cicilan` rows into `liabilities` after the new model is stable.

Proposed liability types:

- `home_loan`
- `personal_loan`
- `vehicle_loan`
- `education_loan`
- `credit_card`
- `other`

Principal and interest interaction with movements:

- EMI payment from wallet is a movement from `wallet -> liability` for principal reduction and/or `wallet -> outside` for interest expense if split details are known.
- If the user records a single EMI movement, backend can allocate principal/interest in liability reporting without making interest a normal category unless explicitly represented.
- Principal repayment reduces liability and does not count as expense for budget/P&L unless KoteCash intentionally reports debt service separately.
- Interest, fees, and penalties are expenses when charged/paid to outside.

## 13. Net-worth calculation

Current net worth should include:

- Wallet balances.
- Fixed deposits from `deposits`.
- Stocks, mutual funds, ETFs, bonds, and other holdings from investment transactions plus prices.
- Retirement assets: EPF, NPS, PPF, SSY from holdings or account snapshots.
- Other investment accounts with manual snapshots.
- Credit-card liabilities.
- Cicilan remaining balances.
- Future loan liabilities.

Calculation rules:

- Wallet-to-investment transfers should not change total net worth; they move value from liquid cash to investment account cash or holdings.
- Purchases should not be treated as expenses; they convert cash/account cash into assets.
- Investment account cash should be counted only if explicitly tracked as cash balance, not inferred blindly from both movements and holdings.
- Legacy portfolio snapshots should not be added on top of holdings for the same account. Use `valuation_mode`:
  - `manual_snapshot`: use `balance_history`/portfolio current value.
  - `holdings`: use holdings plus optional account cash.
  - `hybrid`: use holdings for instrument value and explicit manual cash/other value only.
- Deposits should be counted through `deposits`, not duplicated as investment assets in early phases.
- Credit-card balances and loan balances subtract from assets.

## 14. Monthly net-worth history

The existing six-month reconstruction should evolve into a reusable backend monthly history service.

Recommended snapshot schema additions to `net_worth_snapshots` or a companion table:

| Column | Purpose |
| --- | --- |
| `month` | `YYYY-MM`, unique per user. |
| `assets` | Total assets. |
| `liabilities` | Total liabilities. |
| `net_worth` | Assets minus liabilities. |
| `breakdown_json` | Asset-class and liability-class breakdown. |
| `source` | `auto`, `manual`, `recalculated`, `import`. |
| `locked` | Prevent automatic overwrite after reconciliation. |
| `calculated_at` | Runtime calculation timestamp. |
| `notes` | Manual note. |

Design rules:

- Automatic snapshots can be generated at month end or on first dashboard load after month end.
- Manual snapshots can override or lock values for statement-based accounts.
- Recalculation should be available for unlocked snapshots after old transaction or price corrections.
- Locked snapshots should preserve reported values but display a warning if underlying data now differs materially.
- Historical asset-class breakdown should include wallets, deposits, equities, mutual funds, retirement, other investments, credit cards, loans, and cicilan.
- If historical prices are unavailable, use latest price on or before month end and mark completeness. Do not use future prices for old month-end values.

## 15. Import architecture

Start with CSV. XLSX can be added later by converting the first sheet to the same normalized row format, but CSV is simpler, safer, and dependency-free.

Import components:

- `import_batches`: file-level metadata, hash, status, source type, created counts, error counts.
- `import_rows`: optional row audit with raw JSON, normalized JSON, status, error message, created entity IDs.
- Preview endpoint: validates and maps rows without writing final transactions.
- Commit endpoint: writes valid rows in a controlled batch.
- Rollback endpoint: deletes rows created by a batch when safe.

Batch statuses:

- `uploaded`
- `previewed`
- `validated`
- `partially_imported`
- `imported`
- `failed`
- `rolled_back`

Validation and duplicate detection:

- File hash prevents accidental re-import of the same file.
- Row fingerprint detects duplicate transactions using user, account, asset, date, type, quantity, amount, and external reference.
- Row-level errors should not block preview of other rows.
- Partial import may be allowed only after explicit confirmation.
- Rollback should only remove rows created by the batch and should refuse if later dependent transactions make rollback unsafe.

Recommended KoteCash CSV columns:

```text
account_name,account_type,institution,asset_name,asset_type,symbol,isin,exchange,scheme_code,transaction_type,trade_date,settlement_date,quantity,unit_price,gross_amount,charges,taxes,net_amount,currency,movement_date,movement_amount,movement_src_kind,movement_src_id,movement_dst_kind,movement_dst_id,external_ref,notes,price_date,price,price_source
```

Column mapping should allow user CSV headers to be mapped to these canonical fields. Saved mapping presets can be added later.

## 16. API architecture

All endpoints are under `/api` and follow Hono route conventions: cookie/bearer auth, `user_id` scoping, JSON responses, prepared SQL bindings, and `{ id }` / `{ success: true }` mutation responses.

| Method | Path | Purpose | Major request fields | Major response fields |
| --- | --- | --- | --- | --- |
| `GET` | `/api/wealth/overview` | Current wealth dashboard summary | optional `as_of` | totals, allocation, gain/loss, XIRR, stale prices, recent activity |
| `GET` | `/api/wealth/accounts` | List investment accounts | filters: type, active | accounts with current value, invested, gain/loss |
| `POST` | `/api/wealth/accounts` | Create investment account | name, account_type, institution, currency, valuation_mode | `{ id }` |
| `PUT` | `/api/wealth/accounts/:id` | Update account | editable account fields | `{ success: true }` |
| `DELETE` | `/api/wealth/accounts/:id` | Deactivate/delete account if unused | none or `{ mode }` | `{ success: true }` |
| `GET` | `/api/wealth/assets` | List assets | type, q, active | assets, latest price, stale flag |
| `POST` | `/api/wealth/assets` | Create asset | name, asset_type, symbol, isin, exchange, scheme_code, currency, pricing_mode | `{ id }` |
| `PUT` | `/api/wealth/assets/:id` | Update asset | editable asset fields | `{ success: true }` |
| `GET` | `/api/wealth/transactions` | List investment transactions | account_id, asset_id, type, date range | transactions with linked movement summary |
| `POST` | `/api/wealth/transactions` | Create transaction | transaction fields, optional movement_id | `{ id }` |
| `PUT` | `/api/wealth/transactions/:id` | Update transaction | transaction fields | `{ success: true }` |
| `DELETE` | `/api/wealth/transactions/:id` | Delete transaction | none | `{ success: true }` |
| `GET` | `/api/wealth/prices` | List prices | asset_id, date range | prices |
| `POST` | `/api/wealth/prices` | Upsert price | asset_id, price_date, price, source, notes | `{ id, success }` |
| `GET` | `/api/wealth/holdings` | Current holdings | account_id, asset_type, as_of | holdings with cost, value, gain/loss |
| `GET` | `/api/wealth/xirr` | XIRR report | scope, account_id, asset_id, asset_type, as_of | xirr, status, cash flow summary |
| `GET` | `/api/wealth/liabilities` | Future liabilities list | type, active | liabilities, balances, payment summary |
| `POST` | `/api/wealth/liabilities` | Future liability create | type, name, principal, rate, dates | `{ id }` |
| `POST` | `/api/wealth/imports/preview` | Validate CSV import | file or rows, mapping | batch_id, rows, errors, duplicate warnings |
| `POST` | `/api/wealth/imports/:id/commit` | Commit valid import rows | options: partial, create_missing_assets | created counts, errors |
| `POST` | `/api/wealth/imports/:id/rollback` | Roll back created rows | none | rolled_back counts |
| `GET` | `/api/wealth/imports` | List import batches | status, date range | batches |
| `GET` | `/api/wealth/history` | Monthly net-worth history | from, to, include_breakdown | snapshots, completeness warnings |
| `POST` | `/api/wealth/history/recalculate` | Recalculate unlocked snapshots | from, to | recalculated count, warnings |

## 17. Frontend architecture

Wealth should fit into the existing browser app as a new logical module without introducing React, Vue, Svelte, or another framework.

Proposed pages:

- Wealth Overview: totals, allocation, gain/loss, XIRR, stale price warnings.
- Accounts: investment/retirement accounts and manual snapshot controls.
- Holdings: per-asset and per-account holdings table.
- Transactions: investment transaction ledger.
- Fixed Income: deposits plus fixed-income/retirement account summary.
- Liabilities: current cards/cicilan and future liabilities.
- Import: CSV upload, mapping, preview, commit, rollback history.
- History: monthly net-worth chart and breakdown table.

Navigation:

- Desktop: add a **WEALTH** group or add Wealth Overview under **ANALYZE** and management pages under **MANAGE** if keeping sidebar short.
- Mobile: expose Wealth in the More overlay initially; avoid crowding the bottom five primary actions.

Frontend state and loading:

- Add a `wealth` namespace to `M` instead of scattering many top-level arrays.
- Fetch Wealth data lazily by page where possible; do not add every wealth endpoint to `loadAll()` immediately.
- Use backend summary endpoints for calculations.
- Modals are acceptable for small create/edit forms; use dedicated page sections for import mapping and transaction tables.
- Use Chart.js with the existing destroy/recreate pattern.
- Error states should show row-level import errors, stale price warnings, invalid XIRR reasons, and API validation errors.
- Loading states should be page-specific skeletons/spinners rather than blocking the whole app if only Wealth data is loading.
- Empty states should guide users to create an account, add/import transactions, or enter manual prices.

`public/app.js` should be modularized before implementing the full Wealth UI. Practical approach:

1. Extract API helper, formatting helpers, and modal helpers into small files under `public/js/` loaded before app boot.
2. Extract page renderers gradually: `dashboard.js`, `ledger.js`, `assets.js`, then `wealth/*.js`.
3. Keep globals temporarily for compatibility with inline `onclick` handlers.
4. Do not rewrite routing or introduce a build step.
5. New Wealth UI should start in separate files to avoid making the monolith worse.

## 18. Migration strategy

Do not create migrations in this architecture task. Future ordered migrations should begin after current latest migration `0004_drop_legacy_ledgers.sql`; therefore the first implementation migration should be `0005_...sql`.

Recommended order:

1. `0005_extend_portfolios_for_investment_accounts.sql`: add account type, institution, currency, lifecycle, valuation mode, notes, and indexes.
2. `0006_investment_assets.sql`: create assets table with indexes and uniqueness constraints.
3. `0007_investment_transactions.sql`: create transaction table, indexes by user/account/asset/date/type, optional movement/import links.
4. `0008_investment_prices.sql`: create daily price/NAV table and uniqueness/indexes.
5. `0009_wealth_imports.sql`: create import batches and import rows.
6. `0010_net_worth_snapshot_breakdowns.sql`: extend snapshots with breakdown JSON, source, locked, calculated timestamp.
7. `0011_liabilities.sql`: optional future generalized liabilities table.
8. Later migrations: materialized holding snapshots, account cash sub-ledger, aliases, mapping presets.

Ownership and constraints:

- Every new table must have `user_id`.
- All indexes should include `user_id` as the leading column where queries are user-scoped.
- Use backend validation for polymorphic references and enum values.
- Add unique constraints only after considering imported duplicate data and legacy rows.

Backfill:

- Existing portfolios become accounts with `account_type='other'`, `valuation_mode='manual_snapshot'`, `currency='IDR'`, active.
- Existing deposits remain deposits.
- No automatic conversion of portfolio snapshots to holdings.

Rollback limitations:

- D1 migrations are effectively forward-only in production practice.
- Rollback should mean adding corrective migrations or disabling new code paths, not editing old migrations.
- Import rollback is application-level and only for rows created by an import batch.

## 19. Validation and security

Required validation:

- Ownership validation for every referenced account, asset, movement, price, import batch, wallet, deposit, liability, category, card, and cicilan.
- Referenced account validation: investment transactions can reference only portfolio/investment accounts owned by the user.
- Duplicate account and asset name warnings; hard uniqueness where safe.
- Enum validation for account types, asset types, transaction types, price sources, statuses, and valuation modes.
- Overselling prevention for sell/redemption/transfer-out unless explicitly allowed for migration/import correction.
- Reject negative quantities, negative prices, negative charges, negative taxes, and negative money amounts.
- Validate dates as real `YYYY-MM-DD` and months as real `YYYY-MM`.
- Prevent invalid combinations such as stock asset in EPF-only manual account unless the account supports holdings.
- Prevent linking one movement to multiple incompatible investment transactions unless intentionally split.

Import safety:

- Limit raw CSV file size for Worker memory, for example 1-2 MB initially.
- Limit row count per import, for example 1,000 rows initially.
- Stream or chunk later if needed; do not load huge XLSX files in Worker memory.
- Store file hashes, not raw files, unless a future storage decision is made.
- Escape displayed raw cell values in preview.
- Use SQL prepared statements with `.bind()` for all writes and reads.
- Avoid dynamic SQL except whitelisted order/filter clauses.
- Keep Cloudflare Worker CPU limits in mind: preview/commit should cap rows and return clear errors.

## 20. Testing strategy

Unit tests:

- Holding quantity calculations for buys, sells, transfers, bonuses, and splits.
- FIFO lot depletion and remaining cost basis.
- Average cost calculations.
- Realised gains with charges/taxes.
- Unrealised gains with latest and historical prices.
- XIRR valid cases, invalid cash-flow sets, convergence edge cases, same-day flows, and fully sold investments.
- Net-worth aggregation rules and no double-counting of movements/snapshots.
- Transfer handling between wallet and investment account.
- Dividend received, reinvested, and linked-movement variants.
- Overselling rejection.
- Import duplicate fingerprinting.
- Month-end snapshot reconstruction with stale/missing historical prices.

Integration tests:

- Create account, asset, price, buy transaction, and retrieve holdings.
- SIP with linked movement does not appear as expense.
- Sell/redemption creates realised gain and optional linked wallet movement.
- Import preview with valid rows and row-level errors.
- Import commit partial and rollback behavior.
- User isolation across accounts, assets, prices, transactions, holdings, XIRR, imports, and history.
- Liability principal/interest interaction when future liability routes are added.

## 21. Existing technical-debt dependencies

| Issue | Classification | Reason |
| --- | --- | --- |
| Transaction writes using `/api/transactions` | Must fix before Wealth | Wealth depends on movements being the reliable cash-flow API. Existing write forms target a read-only compatibility route. |
| Portfolio `currentValue` frontend mismatch | Must fix before Wealth | Existing portfolios become investment accounts; wrong displayed value would undermine net-worth and account screens. |
| Credit-card balance mismatch | Fix during relevant Wealth phase | Needed before unified liabilities/net-worth polish, but not blocking foundational investment tables. |
| Deposit `withdrawal_wallet_id` mismatch | Fix during relevant Wealth phase | Needed for fixed-income maturity UX; not blocking investment transaction architecture. |
| Frontend recomputation of dashboard totals | Must fix before Wealth overview | Wealth calculations must be backend-authoritative and frontend should not recalculate totals differently. |
| Monolithic `public/app.js` | Fix during relevant Wealth phase | Start modularization before full Wealth UI, but backend foundations can proceed first. |
| Name-to-ID lookup collisions | Must fix before import/full Wealth forms | Wealth imports and forms need ID-based selections to avoid linking transactions to wrong accounts/assets. |
| Weak authentication | Can defer for private use, but should be prioritized before exposing import/API broadly | Important security debt, but not a data-model prerequisite for local personal use. |

## 22. Implementation phases

### Phase 1: Wealth foundation schema and backend formulas, no full UI

- Goal: establish low-risk account/asset/transaction/price foundations.
- Included: extend portfolios, create assets/transactions/prices, pure calculation helpers, minimal route skeletons or internal services if desired.
- Excluded: full Wealth UI, imports, liabilities migration, live prices, XLSX.
- Database work: migrations `0005`-`0008` if implemented together, or split into smaller migrations.
- Backend work: validation helpers and pure formulas for holdings/FIFO/XIRR.
- Frontend work: none or tiny API docs only.
- Tests: unit tests for formulas and route validation.
- Acceptance criteria: existing tests pass, new formula tests pass, no existing model behavior changes.
- Expected files changed: migrations, `src/server/formulas.ts` or `src/server/wealth/*`, tests, route mount if adding endpoints, docs.

### Phase 2: Minimal investment account/assets/transactions API

- Goal: CRUD for accounts, assets, transactions, prices.
- Included: Hono routes, ownership validation, oversell validation, holdings endpoint.
- Excluded: CSV import, monthly history, full dashboard.
- Database work: indexes/constraints refinements if not in Phase 1.
- Backend work: `/api/wealth/accounts`, `/assets`, `/transactions`, `/prices`, `/holdings`.
- Frontend work: none or hidden API-only usage.
- Tests: route integration tests and user isolation.
- Acceptance criteria: API can create one account, one asset, buy price, and holdings response.
- Expected files changed: `src/server/routes/wealth.ts` or split wealth routes, `src/server/app.ts`, tests, docs/SKILL.md.

### Phase 3: Technical-debt fixes for existing ledger/net worth

- Goal: make existing UI/API consistent before user-facing Wealth screens.
- Included: transaction writes move to `/api/movements`, portfolio value mapping, dashboard API totals display, ID-based form selects.
- Excluded: new investment UI.
- Database work: likely none.
- Backend work: route compatibility if needed.
- Frontend work: `public/app.js` fixes.
- Tests: movement route/write tests, regression tests for portfolio values.
- Acceptance criteria: existing ledger add/edit/delete works through movements and displays correct portfolio values.
- Expected files changed: `public/app.js`, route tests, possibly docs.

### Phase 4: CSV import

- Goal: allow bulk onboarding of investments.
- Included: import batches, row preview, validation, duplicate detection, commit, rollback.
- Excluded: XLSX, broker-specific scrapers.
- Database work: import tables.
- Backend work: parser, mapping, validation, batch writes.
- Frontend work: Import page.
- Tests: duplicate detection, partial import, rollback, row errors.
- Acceptance criteria: user imports a standard CSV and sees created transactions/price rows.
- Expected files changed: migrations, wealth import routes/services, `public/js/wealth/import.js` or `public/app.js`, tests.

### Phase 5: Wealth UI pages

- Goal: user-facing overview, accounts, holdings, transactions, prices.
- Included: Wealth navigation, overview, accounts, holdings, transactions pages, empty/loading/error states.
- Excluded: liabilities migration, XLSX, live prices.
- Database work: none unless refinements.
- Backend work: overview aggregation endpoint.
- Frontend work: modular Wealth JS files and navigation updates.
- Tests: backend aggregation tests; manual UI smoke.
- Acceptance criteria: user can view holdings and gain/loss without formula duplication in frontend.
- Expected files changed: sidebar/mobile nav, public JS modules, route tests.

### Phase 6: Monthly history and net-worth integration

- Goal: integrate investments into net-worth trend.
- Included: month-end reconstruction, breakdown snapshots, recalculation, locked snapshots.
- Excluded: advanced performance materialization unless needed.
- Database work: snapshot breakdown columns/table.
- Backend work: history service and `/api/wealth/history`.
- Frontend work: History page and charts.
- Tests: month-end reconstruction and correction behavior.
- Acceptance criteria: net-worth history includes investment values without double-counting legacy portfolios.
- Expected files changed: migrations, net-worth route/service, wealth history UI, tests.

### Phase 7: Retirement/fixed income polish and liabilities

- Goal: improve EPF/NPS/PPF/SSY/fixed-income and future liabilities.
- Included: account-specific fields, liability model, principal/interest reporting.
- Excluded: tax filing and advisory features.
- Database work: liabilities and optional retirement detail tables.
- Backend work: liability routes and enhanced reports.
- Frontend work: Fixed Income and Liabilities pages.
- Tests: liability balance and net-worth tests.
- Acceptance criteria: retirement assets and loans appear correctly in current and historical net worth.
- Expected files changed: migrations, routes, formulas, frontend modules, tests.

## 23. Phase 1 recommendation

The exact first implementation phase should be foundational and low-risk: create the data-model and calculation foundation without exposing the full Wealth UI.

Exact scope:

- Extend `portfolios` so existing rows can act as investment accounts.
- Create `investment_assets`.
- Create `investment_transactions`.
- Create `investment_prices`.
- Add pure backend calculation helpers for holdings, FIFO cost basis, gain/loss, and XIRR.
- Add unit tests for the helpers.
- Optionally add read-only internal route tests only if routes are included; otherwise keep Phase 1 formula/schema-focused.

Exact files to create in that future task:

- `db/migrations/0005_extend_portfolios_for_investment_accounts.sql`
- `db/migrations/0006_investment_assets.sql`
- `db/migrations/0007_investment_transactions.sql`
- `db/migrations/0008_investment_prices.sql`
- `src/server/wealth/formulas.ts`
- `tests/wealth-formulas.test.ts`

Exact files to modify in that future task:

- `src/server/formulas.ts` only if re-exporting shared helpers is preferred.
- `src/server/types.ts` only if shared wealth types are needed.
- `docs/SKILL.md` only if API-visible behavior is added.

Migration number and purpose:

- Start with `0005_extend_portfolios_for_investment_accounts.sql` because the latest existing migration is `0004_drop_legacy_ledgers.sql`.
- Purpose: make existing portfolios compatible with investment-account semantics while preserving current data and behavior.

Test cases:

- Buy creates positive quantity and cost basis.
- Multiple buys calculate average cost.
- Partial sell depletes FIFO lots and realizes gain.
- Oversell is rejected by formula/validation helper.
- Bonus increases quantity without increasing cost basis.
- Split adjusts quantity and unit cost without changing total cost.
- Latest price computes current value and unrealised gain.
- XIRR returns null for invalid all-positive/all-negative flows.
- XIRR converges for simple buy-current-value and buy-dividend-current-value cases.

Acceptance criteria:

- Existing behavior remains unchanged.
- Existing `npm test` and `npm run build` pass or only show pre-existing failures.
- New formula tests pass.
- Existing portfolios are backfilled as active `other` accounts with manual snapshot valuation.
- No full Wealth UI is added.
- No market/live-price integration is added.

Explicit non-goals:

- No React/Vue/Svelte or frontend rewrite.
- No CSV/XLSX import yet.
- No live streaming prices.
- No tax filing, F&O, intraday, advisory, or multi-tenant features.
- No migration of fixed deposits into investment assets.
- No migration of `cicilan` into new liabilities yet.

## Phase 1 implementation progress

Phase 1 now adds portfolio-backed Wealth account metadata and user-scoped investment assets, with validation and read/write APIs. It intentionally does not implement investment transactions, holdings, prices, gain/loss, XIRR, imports, liabilities, or a Wealth dashboard UI.

## Phase 2 progress note

Phase 2 adds backend-only investment transactions, manual/imported asset prices, and derived holdings APIs. Investment-domain events remain separate from `movements`; `movement_id` is an optional link only when a real cash flow already exists. FIFO holdings, cost basis, realised gain, unrealised gain, stale-price warnings, and summaries are calculated server-side from transactions and prices. XIRR, CSV/XLSX import, automated market fetching, Wealth UI pages, liabilities migration, and net-worth monthly integration remain future work.

## Phase 3 progress note

Phase 3 adds backend XIRR and performance reporting. The canonical API is `GET /api/wealth/performance`, backed by pure XIRR and performance helpers. Investment transactions remain the performance source of truth, linked movements are not double-counted, terminal current value is appended for open holdings only, manual-snapshot accounts can use balance-history terminal values, and invalid XIRR inputs return explicit status values rather than 0%.

## Phase 4 progress note — generic CSV imports

Phase 4 adds a backend-authoritative generic CSV import workflow for wealth accounts, assets, investment transactions, and optional prices. The workflow stores preview batches and row-level audit metadata, detects duplicate files/rows, supports explicit partial-import confirmation, and commits only after revalidation. Imported investment transactions remain separate from `movements`; CSV rows never create ordinary expenses automatically. Rollback is limited to transactions and prices created by the import batch, preserving any accounts/assets that may now be referenced elsewhere. XLSX, PDF/CAS parsing, broker-specific importers, and external price fetching remain out of scope.

## Phase 5 progress note — first Wealth management UI

Phase 5 adds the first complete browser UI for the Personal Wealth module. The implementation keeps calculations backend-authoritative and uses the existing REST APIs for accounts, assets, investment transactions, prices, holdings, performance/XIRR, and CSV imports. Frontend code lives in modular files under `public/js/wealth/` rather than expanding the main SPA file.

Implemented UI tabs:

- Overview: portfolio summary cards, backend performance status, stale/missing price warnings, recent investment transactions, and quick actions.
- Accounts: create, edit, deactivate, inspect holdings, and navigate to account performance for portfolio-backed investment accounts.
- Assets: create, edit, deactivate, add prices, and navigate to asset performance for user-scoped investment assets.
- Transactions: create, edit, delete, filter-ready investment transaction table, movement reconciliation links, transaction-type help, and readable backend validation/oversell errors.
- Prices: add/update same-asset same-date manual prices and delete prices with valuation completeness warnings.
- Holdings: backend-derived quantities, cost basis, current value, realised/unrealised gain, stale price and missing price states.
- Performance: portfolio/account/asset/asset-type scopes using backend XIRR and comparison data, with asset debug details hidden behind an expandable control.
- Import: existing CSV import flow is integrated into the Wealth sub-navigation without rewriting the backend.

Wealth UI money formatting uses KoteCash's existing integer whole-currency convention. Wealth amount fields such as `gross_amount`, `charges`, `taxes`, `net_amount`, portfolio `value`, movement `amount`, and derived `current_value` are stored and returned as whole INR integer units, not paise. A controlled smoke value of `10000` is stored as `10000`, returned by the API as `10000`, and displayed as `₹10,000`; the browser must not divide these values by 100. Decimal quantities and prices are displayed as decimals without frontend recalculation of holdings, gain/loss, FIFO, XIRR, or performance.

Remaining future work intentionally not included in Phase 5:

- Automated market-price fetching and mutual-fund NAV providers.
- Monthly net-worth history integration for Wealth holdings.
- Generalized liabilities.
- Tax/capital-gains reports.
- XLSX/PDF/CAS imports and parser expansion.


## Wealth authenticated smoke-test note — 2026-07-12

Environment: local development/preview only, using a fresh local D1-style database with migrations `0001` through `0010` applied in order and a seeded authenticated user. No production database, remote migration, deployment, or push was performed.

Tested flow: authenticated Wealth navigation for Overview, Accounts, Assets, Transactions, Prices, Holdings, Performance, Import, direct `/?page=wealth`, `wealthTab` sub-tabs, and legacy `/?page=wealth-import`; account/asset creation and editing; buy, dividend, partial sell, oversell rejection, split, price upsert/correction, holdings/performance refresh, CSV template/preview/commit/retry/rollback paths, empty/error rendering, and mobile-width layout checks.

Money storage convention: KoteCash and Wealth use integer whole currency units. The verified `10000` amount convention is stored as `10000`, returned by APIs as `10000`, and displayed as `₹10,000`. This fixes the verified Phase 5 factor-of-100 UI display mismatch caused by treating Wealth amounts as INR paise.

Bugs fixed: Wealth browser money formatting no longer divides integer amounts by 100, transaction amount labels now state whole INR units instead of paise, and regression coverage documents the whole-unit INR display convention.

Known limitations: Wealth still has no automated prices, monthly net-worth integration, generalized liabilities migration, XLSX/PDF/CAS import, or production deployment as intentionally constrained for this phase.

## Phase 6 progress note — Wealth net-worth integration

Phase 6 integrates Wealth investment values into current dashboard totals, the main net-worth response, and monthly net-worth reconstruction. Portfolio records are now valued through one backend valuation service using account `valuation_mode` so legacy manual portfolios, holdings-based accounts, and hybrid accounts are not counted twice.

Valuation modes:

- `holdings`: derived open holdings are valued from investment transactions and the latest investment price on or before the requested as-of date.
- `manual_snapshot`: value comes from the latest `balance_history` portfolio snapshot on or before as-of; holdings are not added on top.
- `hybrid`: holdings are authoritative when detailed holdings exist. If holdings are absent, the service falls back to the latest manual snapshot and reports a warning because the schema cannot yet distinguish residual account cash from total account value.

Historical reconstruction uses the same valuation service for each month end and never looks forward to future prices. Missing historical prices exclude that open holding from market value and mark the month incomplete. Stale prices and excluded accounts are surfaced as warnings. Whole-INR integer amounts remain the reporting convention.

## FY 2026 cutover and AI extraction foundation progress

KoteCash Wealth now has a deterministic FY 2026 cutover foundation for tracking investments from 1 April 2026 onward. Previous-FY tradebooks are reduced into FIFO opening `transfer_in` positions dated 31 March 2026, while current-FY rows are staged as ordinary import rows. Closed pre-cutover positions are summarized rather than shown as active-period transactions. Oversold or incomplete pre-cutover histories are blocked as unresolved instead of creating negative positions.

Order-level preprocessing can aggregate execution rows by trade date, order id, symbol, ISIN, exchange, and transaction type. Quantities and weighted prices use normalized decimal helpers; money remains whole-INR integers using half-up rounding. Opening positions and current-FY rows reuse the existing Wealth import preview, duplicate fingerprinting, oversell simulation, commit, idempotent retry, and rollback mechanics. No automatic movements are created.

The OpenAI integration is a server-only structured extractor. Raw financial files are sent to OpenAI only after the user requests extraction, and no financial records are added until the user reviews the extraction, prepares an import preview, and separately confirms the existing import commit. Raw file bytes are not retained; stored audit data is limited to file hash, masked metadata, extraction JSON, validation results, model/response identifiers, and usage metadata. Supported initial files are PDF, PNG, JPG/JPEG, text/plain, and explicitly selected CSV layout interpretation. The model is configured with `OPENAI_DOCUMENT_MODEL`; the API key is provided only through the Cloudflare secret `OPENAI_API_KEY`.

Current limitations: extraction supports only holdings statements, broker tradebooks, broker contract notes, and unknown documents as generic structured proposals. It does not fetch market prices, create tax reports, commit bank/credit-card/EPF/NPS data, ingest email, batch process documents, handle password-protected PDFs, deploy production changes, or apply remote migrations.

## KoteCash Wealth import duplicate asset cleanup guidance

After deploying the rolled-back duplicate detection and asset ambiguity fix, clean up duplicate active TCS assets manually through the application only:

1. Open **Wealth → Assets**.
2. Search for **TCS** or ISIN **INE467B01029**.
3. Identify duplicate active assets returned for the same ISIN.
4. Preserve the asset referenced by surviving transactions, prices, or opening holdings.
5. Deactivate only the unreferenced duplicate asset; the backend blocks deactivation when surviving transactions or prices reference the asset.
6. Re-preview the complete 56-row canonical CSV and confirm the preview reports 56 total, 56 valid, 0 invalid, and 0 duplicate before committing.

Do not auto-merge duplicate assets and do not edit production data directly outside the Wealth Assets UI/API.

## Phase 7A progress note — manual market price refresh

Phase 7A adds a provider-neutral market-data boundary and a reusable Wealth market-price refresh service for manual Indian stock price updates. The initial adapter supports Twelve Data through server-side Cloudflare environment configuration, uses native `fetch`, and stores successful quotes in `investment_prices` with `source='market'` while preserving existing valuation semantics. Refreshes are explicit user actions only; no Cloudflare Cron, exchange scraping, mutual-fund NAV fetching, or realtime-feed claims are included in this phase.

The refresh API is mounted at `POST /api/wealth/market-prices/refresh`, with status metadata at `GET /api/wealth/market-prices/status`. Audit summaries are persisted in `wealth_price_refresh_runs` without API keys, raw payloads, or full provider URLs.

### Phase 7B progress note: Marketstack EOD prices and CSV fallback

Market-price refresh now uses an EOD-first provider architecture. Marketstack is the preferred provider for latest completed end-of-day closes, while Twelve Data remains selectable as an optional adapter. The refresh service remains provider-neutral, batches supported symbols, returns per-asset success/failure rows, stores only `investment_prices`, protects same-date manual/import prices, and records audit run completion as completed, partially completed, or failed.

A provider-symbol mapping table (`wealth_provider_symbols`) supports deterministic provider ticker resolution without scraping exchange websites. NSE symbols use Marketstack's `XNSE` suffix first; BSE is available for explicit verified mappings. A manual EOD CSV preview/commit fallback was added for cases where provider coverage or plan access is unavailable.

## Phase 8 progress note

Phase 8 adds a consolidated Wealth Overview endpoint and a mobile-first overview UI. The endpoint reuses backend holding and performance formulas to provide summary valuation, XIRR status, allocation analytics, gain/loss rankings, valuation-health messages, and recent investment transactions. Partial valuations return priced partial value and grouped health messages instead of showing raw warning codes in the primary UI. Allocation percentages exclude unpriced open holdings from the current-value denominator and exclude inactive or net-worth-excluded accounts.

## Phase 9 note — manual retirement and investment valuations

Phase 9 extends Personal Wealth from stock-focused holdings to manually tracked investments: mutual funds, EPF, NPS, PPF, SSY, fixed deposits, gold, bonds, crypto, cash equivalents, and other investments. The architecture now treats `wealth_valuation_snapshots` as the reusable manual/import/formula snapshot source and routes Dashboard, Net Worth, Wealth Overview, and monthly history through the shared Wealth valuation service. Valuation precedence is intentionally conservative to avoid double counting between asset-level snapshots and account-level aggregate snapshots. Formula valuation is estimate-only for fixed deposits and optional PPF/SSY metadata; user-entered snapshots remain authoritative when configured through manual or hybrid modes. No external NAV, EPFO, NPS CRA, CAMS/KFintech, tax, loan, deployment, or remote-migration behavior is introduced in this phase.

## Phase 10 note: monthly net-worth history

Phase 10 extends the existing `net_worth_snapshots` reporting table into the canonical monthly history store. A snapshot is keyed by `YYYY-MM`, dated to month end except the current month, and stores backend-calculated asset, investment, cash, other-asset, liability, and net-worth totals plus valuation health and JSON breakdowns. Snapshot generation reuses the shared Wealth valuation services for holdings, dated manual snapshots, formula assets, and hybrid fallbacks, so frontend pages render historical reporting without duplicating valuation formulas.

Locked snapshots preserve historical totals and breakdowns until explicitly unlocked. Range backfill is controlled by preview and confirmation; unavailable historical data creates partial snapshots rather than fabricated numbers. Phase 10 does not add liability CRUD, tax calculations, external providers, or remote deployment behavior.

## Phase 11 note — Liabilities and debt integration

Phase 11 introduces normalized liabilities for loans, credit cards, BNPL, overdrafts, informal loans, repayment records, lender/manual balance snapshots, and estimated amortization schedules. Ledger movements remain the source of truth for ordinary cashflow, and liability payments may link to existing movements without duplicating expenses. Net Worth now subtracts active liabilities that are included in net worth, using as-of balance snapshots, payment-based estimates, or amortization/hybrid fallbacks. Monthly snapshots preserve locked history and store liability category breakdowns alongside asset breakdowns.

## Phase 12 note: financial goals and planning

Phase 12 adds normalized financial goals as a planning/reporting layer above Wealth, Liabilities, Net Worth, wallets, and the movement ledger. Goals can be manually funded, linked to valued wealth accounts/assets, linked to liabilities for debt payoff tracking, or hybrid. Backend goal calculations own progress, inflation-adjusted target estimates, monthly contribution estimates, scenario comparisons, emergency-fund coverage, retirement estimates, debt-payoff progress, valuation warnings, and allocation-overlap warnings.

Goals intentionally do not create movements, investment transactions, liability payments, or Net Worth changes. Goal contributions are informational links or manual annotations, not source ledgers. Deletion uses safeguards: goals with dependencies are cancelled rather than hard-deleted, and linked financial records remain untouched.

## Phase 14 note: budgets and cash-flow insights

Phase 14 adds monthly budgets, cash-flow summaries, category analytics, recurring-spend candidates, and deterministic alerts on top of the existing movement ledger. Ordinary income and expenses continue to come from `movements`; internal transfers, debt payments, and investment contributions are separated so they do not distort consumption budgets or savings-rate reporting. Investment contributions remain visible as wealth outflows, but they are not treated as ordinary expenses or investment recommendations.

## Phase 15 statement imports note

Phase 15 adds a reviewed statement-import layer beside the existing Wealth CSV importer. Generic financial import batches and rows track bank, credit-card, loan, mutual-fund, EPF, NPS, generic ledger, generic valuation, and generic liability CSV workflows from upload through mapping, preview, validation, duplicate/match review, commit, reconciliation, and rollback. Ledger movements remain authoritative for bank and card income/expense imports, while Wealth and liability imports are routed to their existing domain models only when explicitly confirmed. Rollback is intentionally narrow: it may remove only records created by a specific import batch and preserves matched pre-existing Ledger, PennyWise, Wealth, and liability records.
