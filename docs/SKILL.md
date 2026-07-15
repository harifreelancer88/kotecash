---
name: kotecash
description: Interact with the kotecash household finance API via the movements ledger — wallets, deposits, portfolios, credit cards, cicilan, budgets, goals, and recurring payments.
version: 2.0.0
---

# KoteCash — AI Agent Skill (v2.0.0)

A household finance ledger built on a single **movements** ledger: every money movement is one row with an explicit source and destination account. Use this skill to record spending, move money between accounts, manage budgets, track debt, schedule recurring payments, and report financial health.

## ⚠️ Critical Rules

1. **NEVER query the database directly.** You have NO database access. The only way to read or write data is the HTTP REST API below. Do not attempt SQL, D1, wrangler, or any DB connection. If the API does not expose it, it does not exist for you.
2. **Always send the Bearer token** on every request via the `Authorization` header. No token = 401.
3. **Capture IDs from create responses.** Categories, wallets, goals, etc. return an `id`. You need those IDs to reference them in transactions, budgets, and earmarks.

## Production URL

```
https://your-worker.example.com
```

All endpoints are prefixed with this base URL. Use this in every request.

## Authentication

```
Authorization: Bearer kote_<your-token>
```

The token is a long-lived API token (`kote_...` prefix). If you receive `401 {"error":"Unauthorized"}`, the token is invalid or revoked — ask the user to regenerate it.

---

## The movements model (read this first)

Every money movement is one row in the `movements` ledger with a **source** (`src_*`) and **destination** (`dst_*`) account. `amount` is always positive; direction is src→dst.

Account kinds: `wallet`, `deposit`, `portfolio`, `credit_card`, `cicilan`. A null src means **outside** (income); a null dst means **outside** (expense).

| Real event | src → dst | P&L |
|------------|-----------|-----|
| Salary | `outside → wallet` | income |
| Groceries | `wallet → outside` | expense |
| Wallet→wallet | `wallet → wallet` | — |
| Buy deposito | `wallet → deposit` | — |
| Withdraw deposito | `deposit → wallet` | — |
| Buy/sell investment | `wallet ↔ portfolio` | — |
| Pay cicilan | `wallet → cicilan` | — (debt reduction) |
| CC charge | `credit_card → outside` | expense |
| Pay CC bill | `wallet → credit_card` | — |

**Balances derive from movements** (never stored directly): wallets = `initial_balance` + in − out; deposits = `amount` + in − out; cicilan = `total_utang` − payments; credit cards = `balance` + charges − payments. **Portfolio value** is the latest `balance_history` snapshot minus outflows since (market value isn't a cash movement — update it with `PUT /api/portfolios/:id`).

**P&L** (for budgets/savings): `income` = movements with null src in the month; `expense` = movements with null dst in the month. Debt payments have a real destination so they're automatically excluded from expense.

---

## Setup Order (when seeding fresh data)

You must create dependencies before things that reference them:

1. **Categories** → capture each `id`
2. **Wallets** → capture each `id`
3. **Movements** (reference `category_id` + src/dst accounts) — or use the wallet income/expense shortcuts
4. **Budgets** (reference `category_id` + `month`)
5. **Cicilan, Credit Cards, Deposits, Portfolios** (independent)
6. **Goals** → then **Earmarks** (reference `goal_id` + source)
7. **Recurring templates** (reference src/dst accounts + category)

---

## Endpoints

### Categories — `POST /api/categories`
Create before transactions/budgets.
```json
{ "name": "Makan", "type": "expense", "is_debt_service": false }
```
- `type`: `income` | `expense`
- `is_debt_service`: `true` for fixed debt payments (BRI, CC) → excluded from regular budgets
- **GET /api/categories** → list. Capture `id`.

### Movements (the ledger) — `POST /api/movements`
The universal write primitive. One row per money movement.
```json
{
  "date": "2026-06-21",
  "amount": 45000,
  "category_id": 3,
  "description": "GoFood lunch",
  "src_kind": "wallet",
  "src_id": 6,
  "dst_kind": null,
  "dst_id": null
}
```
- `amount` must be > 0. Direction is src→dst.
- `src_kind`/`dst_kind` ∈ `wallet` | `deposit` | `portfolio` | `credit_card` | `cicilan` | `null` (null = outside world). `src_id`/`dst_id` are null when the kind is null. **At least one end must be a real account.**
- null src = income (outside→account); null dst = expense (account→outside).
- `category_id` is the P&L dimension (optional for pure transfers).
- `GET /api/movements` filters: `?wallet_id=&category=&month=YYYY-MM&q=`. `wallet_id` matches either end.
- `POST /api/movements/batch` → `{ "items": [ {…same shape…}, … ] }` for monthly bills etc.
- `PUT /api/movements/:id` (full replace), `DELETE /api/movements/:id`.

> **Backwards compat:** `GET /api/transactions` still works as a **read-only** view (maps movements → old `{type, category_id, …}` shape) so existing consumers keep running. Writes go to `/api/movements`.

### Wallets
- `POST /api/wallets` → `{ name, type ("bank"|"e-wallet"|"cash"), account_number, initial_balance }`
- `GET /api/wallets` → each wallet includes **derived** `balance`, `earmarked`, `free`, `activity` (recent movements touching it)
- `POST /api/wallets/:id/income` → `{ amount, category_id, date, description }` (creates `outside → wallet` movement)
- `POST /api/wallets/:id/expense` → same shape (creates `wallet → outside` movement). May return a **warning** if spend exceeds free balance:
  ```json
  { "id": 12, "warning": { "type": "earmark_overspend", "amount": 500000, "free": 200000, "into": 300000, "impactedGoals": ["Umroh"] } }
  ```
  The movement is still recorded. Relay the warning to the user.
- `POST /api/wallets/transfer` → generalized: `{ src_kind?, src_id?, dst_kind?, dst_id?, amount, date, notes }`. Defaults to `wallet`→`wallet`; accepts any account kinds (e.g. `dst_kind:"deposit"` to move cash into a deposito). Also accepts legacy `{ from_wallet_id, to_wallet_id }`.
- `PUT /api/wallets/:id` (name, account_number), `DELETE /api/wallets/:id` (cascades its movements)

### Cicilan (installments)
- `POST /api/cicilan` → `{ name, total_utang, monthly_payment, tenor_bulan, bunga_persen, start_date, due_date }`
- `GET /api/cicilan` → includes derived `sisa` (remaining = `total_utang` − payments), `monthsLeft`, `pctPaid`
- `GET /api/cicilan/:id/schedule` → amortization table
- `POST /api/cicilan/:id/pay` → `{ amount, wallet_id (or src_id), date, description, category_id }` (creates `wallet → cicilan` movement; reduces `sisa`; not counted as expense)
- `DELETE` only allowed when `sisa == 0`.

### Credit Cards
- `POST /api/credit-cards` → `{ name, limit_amount, statement_day, due_day, interest_rate, annual_fee }` (no opening balance — charges accumulate via movements)
- `GET /api/credit-cards` → includes derived `balance` (owed), `utilization`, `color`, `available`
- A CC charge = `POST /api/movements` with `src_kind:"credit_card", src_id:<ccId>, dst_kind:null` (+ category). Paying the bill = `POST /api/wallets/transfer` with `dst_kind:"credit_card"`.
- `DELETE` only when derived `balance == 0`

### Budgets and cash-flow insights (Phase 14)
- `POST /api/budgets` creates a budget without creating Ledger movements. Body supports `{ name, category_id, amount, budget_amount, month, start_date, end_date, budget_type, rollover_enabled, rollover_amount, alert_percent, status, notes }`. `budget_type` is `monthly_category`, `monthly_total`, `income_target`, `savings_target`, or `custom_period`; `status` is `active`, `paused`, or `archived`. Amounts must be positive finite integers.
- `GET /api/budgets?month=2026-06&category_id=&status=&exceeded_only=true` returns backend-calculated rows with `base_amount`, `rollover_amount`, `effective_budget`, `actual_spending`, `remaining_amount`, `used_percentage`, `projected_month_end_spending`, `days_elapsed`, `days_remaining`, `daily_safe_to_spend`, `status`, and `warnings`.
- `GET /api/budgets/:id`, `PUT /api/budgets/:id`, and `DELETE /api/budgets/:id` manage budgets. Delete archives the budget so history remains available.
- `GET /api/budgets/summary` returns the same calculated budget rows for dashboard and budget overview screens.
- `POST /api/budgets/copy-previous-month` and `POST /api/budgets/create-from-average` require preview mode before creating multiple budgets; existing active category/month budgets are not silently overwritten.
- Rollover shows `base_amount`, `rollover_amount`, and `effective_budget`. Positive unused amounts may be carried manually; overspending is not automatically deducted from the next month.

### Cash Flow — backend-calculated read-only APIs
- `GET /api/cash-flow/monthly?month=YYYY-MM&wallet_id=&category_id=` returns monthly money-flow metrics. Definitions: income = outside→owned-account Ledger movements; ordinary expenses = owned-account→outside movements excluding investment/debt classifications; transfers = owned→owned movements and are excluded from income/expense; debt payments = wallet→cicilan/credit-card or debt-payment classified movements and are shown separately; investment contributions = portfolio-bound or investment-classified cash outflows and are shown separately from consumption.
- Savings amount = `income − ordinary expenses − debt payments`. Savings rate = `savings amount / income`; it is `null` when income is zero.
- `GET /api/cash-flow/categories?month=YYYY-MM` returns category analytics: current/previous month spend, change, averages, budget use, counts, largest transaction, recurring portion, and discretionary portion. Parent/child category support is represented by `parent_category_id` on budgets; API aggregation avoids adding the same movement twice.
- `GET /api/cash-flow/trends?date_from=YYYY-MM&date_to=YYYY-MM&grouping=month` returns monthly cash-flow rows.
- `GET /api/cash-flow/recurring-candidates` detects likely recurring expenses by similar merchant, similar amount, regular interval, and same wallet/category. It returns frequency, next expected date, confidence, monthly/annual equivalent cost, and `requires_confirmation:true`; it never creates recurring schedules automatically.
- `GET /api/cash-flow/alerts` returns deterministic, explainable alerts such as budget threshold/exceeded, projected deficit, spending increase, unusual transaction, and low savings rate. Alerts are not professional financial advice.
- Category classifications can be manually stored in `category_classifications` as `fixed`, `variable`, `discretionary`, `essential`, `debt_payment`, `investment`, `transfer`, or `income`; the app does not overwrite user categories automatically.

### Goals & Earmarks
- `POST /api/goals` → `{ name, target_amount, icon }`
- `POST /api/goals/:id/allocate` → `{ source_type ("wallet"|"deposit"|"portfolio"), source_id, amount }` (virtual allocation; does not move real money)
- `DELETE /api/earmarks/:id` → remove an allocation
- `GET /api/goals` → each includes `progress`, `pct`, `reached`, `earmarks[]`

### Assets — Deposits & Portfolios
- **Deposits**: `POST /api/deposits` → `{ bank, amount, rate, tenor_months, start_date, maturity_date, withdrawal_wallet_id }`. `amount` is the principal (also the balance base). `withdrawal_wallet_id` is where it flows on maturity/withdrawal (bound to your default wallet by default).
  - `GET /api/deposits` → includes derived `balance` (= `amount` − withdrawals), `interestEarned`, `maturityValue`, `status`
  - `POST /api/deposits/:id/withdraw` → `{ amount, wallet_id?, interest?, date, description }` (creates `deposit → wallet` movement; optional `interest` creates an `outside → wallet` income movement)
- **Portfolios**: `POST /api/portfolios` → `{ name, value }` (the seed snapshot). Value changes are tracked by **snapshots**, not a single column.
  - `GET /api/portfolios` → each includes derived `currentValue` = latest snapshot − outflows since
  - `PUT /api/portfolios/:id` → **value update** `{ name, value }`: appends a `balance_history` snapshot (paper gain/loss; sets `last_snapshot_at`). Do this weekly/monthly to track growth.
  - `POST /api/portfolios/:id/trade` → `{ amount, wallet_id, direction ("buy"|"sell"), date, description }` (cash movement: buy = `wallet → portfolio`, sell = `portfolio → wallet`)
- Both have `DELETE`.


### Wealth foundation APIs (Phase 1)

- **Wealth accounts**: `/api/wealth/accounts` exposes investment accounts derived from existing `portfolios`.
  - `GET /api/wealth/accounts?active=true|false&account_type=...` returns account metadata plus `currentValue` using the same portfolio snapshot valuation logic.
  - `POST /api/wealth/accounts` creates a portfolio-backed investment account and optional `opening_value` snapshot.
  - `PUT /api/wealth/accounts/:id` updates account metadata and lifecycle flags.
  - `DELETE /api/wealth/accounts/:id` soft-deactivates the account by setting `is_active=0`; it does not delete history.

- **Wealth assets**: `/api/wealth/assets` manages user-scoped investment instruments.
  - `GET /api/wealth/assets?asset_type=...&active=true|false&q=...` lists assets for the current user.
  - `POST /api/wealth/assets` creates an asset with validated type, identifiers, currency, price source, and pricing mode.
  - `PUT /api/wealth/assets/:id` updates editable asset metadata and `updated_at`.
  - `DELETE /api/wealth/assets/:id` soft-deactivates the asset by setting `is_active=0`.

### Recurring payments — `POST /api/recurring`
Templates that auto-generate movements on a schedule. Sweep runs lazily on each `/api/dashboard` load (any template with `next_run <= today` is materialized into a movement, then `next_run` advances).
```json
{
  "frequency": "monthly",
  "day_of_month": 5,
  "amount": 150000,
  "description": "BPJS",
  "category_id": 5,
  "src_kind": "wallet", "src_id": 6,
  "dst_kind": null, "dst_id": null,
  "next_run": "2026-07-05"
}
```
- `frequency`: `monthly` | `yearly` | `weekly` | `daily`. Monthly uses `day_of_month`; yearly adds `month_of_year`; weekly uses `weekday`.
- `src_*`/`dst_*`/`category_id` define the movement each occurrence creates (same rules as `/api/movements`).
- `GET /api/recurring` → list templates; `DELETE /api/recurring/:id` → stop one.
- A manual sweep is also available at `POST /api/recurring/sweep` (returns `{ emitted }`).

### Read-only aggregates (use these to answer questions, NOT manual math)
- `GET /api/dashboard?month=2026-06` → income, expense, sisa, totalLiquid, totalFree, totalEarmarked, totalCC, totalDeposits, totalPortfolios, totalAssets, totalCicilanSisa, netWorth, savingsRate, savingsTier, dti, dtiTier
- `GET /api/net-worth` → **6-month historical time-series**, reconstructed as-of each month-end:
  ```json
  { "snapshots": [ { "month": "2026-01", "assets": 73850000, "liabilities": 54500000, "netWorth": 19350000 }, ... ], "delta": 5000000 }
  ```
  Both `assets` and `liabilities` move over time. Wallets/deposits/credit cards/cicilan are reconstructed from dated movements; portfolios from balance_history snapshots. `delta` = last month's net − previous month's net. Use this for growth, not `/api/dashboard` (current-month snapshot only).

### Historical balances
- **All account kinds except portfolios** derive balance from movements, so the net-worth trend reflects the month each movement is dated in.
- **Portfolios** keep an append-only `balance_history` of value snapshots. Every `PUT /api/portfolios/:id` appends a timestamped point; past points are never overwritten. No endpoint reads raw history — it surfaces via `GET /api/net-worth` and the per-portfolio `currentValue`.

### API Tokens
- `POST /api/tokens` → `{ label }` → returns full `token` **once**
- `GET /api/tokens` → list (prefix only)
- `DELETE /api/tokens/:id` → revoke

---

## Currency & Format
- All amounts are **IDR integers** (rupiah, no decimals). e.g. `45000` = Rp45.000.
- Dates: `YYYY-MM-DD`. Months: `YYYY-MM`.

## Health Tiers (for interpretation)
- **Savings Rate:** ≥30% Outstanding · ≥20% Excellent · ≥10% Good · <10% Needs Improvement
- **DTI:** <30% Healthy · <50% High · ≥50% Critical

## Quick Start (curl)
```bash
TOKEN="kote_..."

# Create a category, capture id
curl -s -X POST https://your-worker.example.com/api/categories \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Makan","type":"expense"}'

# Log an expense from wallet 6 (use the category id from above)
curl -s -X POST https://your-worker.example.com/api/movements \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"date":"2026-06-21","amount":45000,"category_id":1,"src_kind":"wallet","src_id":6,"dst_kind":null,"dst_id":null,"description":"GoFood"}'

# Move cash from a wallet into a deposito (any src/dst kinds)
curl -s -X POST https://your-worker.example.com/api/wallets/transfer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"src_kind":"wallet","src_id":6,"dst_kind":"deposit","dst_id":1,"amount":5000000,"date":"2026-06-21","notes":"Buy deposito"}'

# Schedule a monthly recurring bill
curl -s -X POST https://your-worker.example.com/api/recurring \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"frequency":"monthly","day_of_month":5,"amount":150000,"description":"BPJS","category_id":5,"src_kind":"wallet","src_id":6,"dst_kind":null,"dst_id":null,"next_run":"2026-07-05"}'

# Ask for this month's health
curl -s https://your-worker.example.com/api/dashboard \
  -H "Authorization: Bearer $TOKEN"

# 6-month net-worth growth trend (assets/liabilities/net per month)
curl -s https://your-worker.example.com/api/net-worth \
  -H "Authorization: Bearer $TOKEN"
```

## Personal Wealth Phase 2 APIs

Investment transactions are distinct from the canonical `movements` cash-flow ledger. Buys and SIPs do not automatically create normal expenses or movements; provide `movement_id` only to link an already-existing real cash flow.

### `GET /api/wealth/transactions`
Lists investment-domain events for the authenticated user. Optional filters: `account_id`, `asset_id`, `transaction_type`, `from`, `to`, and `q`. Results include account, asset, and linked movement summary fields and are ordered by trade date descending then id descending.

### `POST /api/wealth/transactions`
Creates a transaction. Supported types are `buy`, `sell`, `sip`, `redemption`, `dividend`, `interest`, `contribution`, `withdrawal`, `transfer_in`, `transfer_out`, `bonus`, `split`, `charges`, and `maturity`. The backend validates account/asset/movement ownership, normalizes quantity and price decimals, derives unambiguous amounts, and rejects oversells. No movement is created automatically.

### `PUT /api/wealth/transactions/:id`
Updates an owned investment transaction and validates the full resulting account/asset sequence so the edit cannot create an oversold holding.

### `DELETE /api/wealth/transactions/:id`
Physically deletes an owned investment transaction for now, unless removal would invalidate a later sell/redemption/transfer-out sequence.

### `GET /api/wealth/prices`
Lists owned asset prices newest first. Optional filters: `asset_id`, `from`, `to`, and `source`.

### `POST /api/wealth/prices`
Creates or corrects a price for an owned asset/date. Fields: `asset_id`, `price_date`, `price`, `currency`, `source`, and `notes`. Prices are normalized decimal strings and upsert on `(user_id, asset_id, price_date)`. No external provider fetching is performed.

### `DELETE /api/wealth/prices/:id`
Deletes an owned price row.

### `GET /api/wealth/holdings`
Calculates backend-authoritative holdings from transactions and latest owned prices on or before `as_of`. Optional filters: `account_id`, `asset_id`, `asset_type`, `as_of`, and `include_closed=true|false`. Returns per-holding quantity, remaining FIFO cost basis, average cost, latest price, current value, realised/unrealised/total gains, absolute return percentage, stale price flag, warnings, and a summary. XIRR is not implemented yet.

## Wealth performance / XIRR API (Phase 3)

`GET /api/wealth/performance` is the canonical backend endpoint for reusable investment-performance reporting. It calculates XIRR on the server from `investment_transactions`; linked `movement_id` values are reconciliation metadata and are never added as duplicate cash flows.

Query parameters: `scope=portfolio|account|asset|asset_type` (defaults to `portfolio`), `account_id`, `asset_id`, `asset_type`, `as_of=YYYY-MM-DD`, `include_closed=true|false`, and optional `debug=true`.

Cash-flow signs use the investor perspective: buys, SIPs, contributions, standalone charges, and transfer-ins with reliable cost basis are negative; sells, redemptions, withdrawals, dividends, interest, and maturities are positive. Bonus and split transactions are not direct cash flows. Transfer-ins without cost basis are excluded and return a warning. Transfer-outs are not treated as investment returns unless proceeds are recorded.

Open holdings append current value once as a terminal positive cash flow on the valuation date. Closed holdings do not receive a fake terminal value. Account and portfolio reports append the aggregate open-holding terminal value once, not both asset terminal values and an account terminal value. Missing prices make valuation incomplete instead of silently assuming zero; stale prices may warn while still computing.

Responses include invested/returned cash flow, income, charges, current value, realised/unrealised/total gains, absolute return, `xirr`, `xirr_status`, optional `xirr_reason`, cash-flow dates/count, warnings, and `valuation_complete`. `xirr` can be `null` when inputs are insufficient, have no sign change, use invalid dates, or fail to converge; clients should display the status/reason rather than treating it as 0%.

Manual-snapshot investment accounts use the latest `balance_history` snapshot on or before `as_of` as terminal value. Precedence is: investment transactions first; linked movement only as reconciliation metadata; account-level movements only as fallback for manual-snapshot legacy accounts without investment transactions.

No Wealth frontend pages exist yet; use these APIs directly.

### Wealth CSV imports (Phase 4)

Generic CSV import is a CSV-first, auditable workflow for wealth accounts, assets, investment transactions, and optional asset prices. XLSX, PDF/CAS parsing, broker-specific parsers, and automated market/NAV fetching are not supported yet.

Critical rules:
- Imports never create final financial records during file selection or preview.
- Workflow is `upload/parse → map → validate → preview → explicit commit`.
- Imports are user-scoped and do not create ordinary `movements`; `movement_id` may only link to an existing movement owned by the authenticated user.
- Duplicate files and duplicate rows are detected before commit. Partial import requires explicit confirmation.
- Row-level errors are shown without hiding valid rows.
- Rollback deletes only transactions/prices created by the batch; created accounts/assets are preserved.

Limits:
- CSV only, UTF-8, comma-delimited, quoted fields and quoted line breaks supported.
- Maximum file size: 2 MB. Maximum data rows: 2,000. Maximum columns: 60. Maximum cell length: 10,000 characters.

Standard columns:
`account_name, account_type, institution, asset_name, asset_type, symbol, isin, exchange, scheme_code, transaction_type, trade_date, settlement_date, quantity, unit_price, gross_amount, charges, taxes, net_amount, currency, movement_id, external_ref, notes, price_date, price, price_source`

- `POST /api/wealth/imports/preview` accepts multipart form data with `file`, `mapping` JSON, and `options` JSON. It parses CSV, validates mappings, normalizes rows, resolves existing/candidate accounts/assets, detects duplicates and oversells, stores preview metadata, and returns counts plus limited row details.
- `GET /api/wealth/imports?status=&from=&to=` lists import batches newest first.
- `GET /api/wealth/imports/:id?page=&page_size=` returns a user-owned batch, mapping/options, paginated rows, counts, and commit/rollback eligibility.
- `POST /api/wealth/imports/:id/commit` explicitly commits a previewed batch. Body options include `allow_partial`, `create_missing_accounts`, `create_missing_assets`, and `skip_duplicates`. Commit rechecks ownership, duplicates, movement links, and oversells, then creates investment transactions and upserts same-date prices with `import_batch_id`. Retrying is idempotent for already imported rows.
- `POST /api/wealth/imports/:id/rollback` rolls back imported or partially imported batches by deleting only batch-created investment transactions and prices. It refuses rollback when later non-imported transactions could be invalidated. Accounts/assets are not deleted.
- `GET /api/wealth/imports/template` downloads the standard CSV header template.

### Phase 6 Wealth net-worth integration

KoteCash exposes Wealth investment values in the dashboard and net-worth APIs. Backend APIs are authoritative; clients should display returned totals and breakdowns instead of recalculating financial values in JavaScript.

#### Valuation mode rules

Investment accounts are stored in `portfolios` and use `valuation_mode`:

- `holdings`: account value is the sum of open holdings derived from `investment_transactions`, valued with the latest `investment_prices.price_date` on or before `as_of`.
- `manual_snapshot`: account value is the latest `balance_history` row for `entity_kind='portfolio'` on or before `as_of`; detailed holdings are not added.
- `hybrid`: holdings are authoritative when present. If no holdings exist, the latest manual snapshot is used and a warning explains the fallback. Full manual snapshots are never added on top of holdings.

Historical calculations never use future prices. Missing prices mark valuation incomplete and the affected holding is excluded from market value; cost basis is not silently treated as market value. `include_in_net_worth=0` accounts are excluded from net-worth totals but may be reported separately. Amounts remain whole-INR integers.

Canonical current net worth is produced by the shared monthly reconstruction service. For the current month it is valued as of today; for historical months it is valued as of month end. Dashboard live net worth and the Net Worth current value must both use this service and must not mix current balances with locked or generated snapshot totals unless the UI labels the value as historical.

Canonical total investments are `market holdings + other Wealth investment value`. Market holdings are transaction-derived open holdings with prices. Other Wealth investment value includes active included EPF, NPS, PPF, SSY, fixed deposits, gold, manual-snapshot, hybrid fallback, and formula-valued accounts. Manual or legacy account values are included once through the shared Wealth aggregation service and are not added on top of account holdings.

#### Dashboard fields

`GET /api/dashboard` preserves existing fields and adds:

- `wealthInvestmentValue`
- `wealthHoldingsValue`
- `wealthManualSnapshotValue`
- `wealthValuationComplete`
- `wealthWarnings`
- `excludedWealthInvestmentValue`
- `assetBreakdown` with `wallets`, `deposits`, `stocks`, `mutual_funds`, `etfs`, `retirement`, `fixed_income`, `manual_portfolios`, and `other_investments`

#### Net-worth response

`GET /api/net-worth` returns monthly snapshots with current and historical assets, liabilities, net worth, `assetBreakdown`, `liabilityBreakdown`, Wealth totals, `valuation_complete`, and warnings. Wallets/deposits/liabilities continue to use movement-based reconstruction. Wealth accounts use the valuation rules above for each month end.

#### Snapshot endpoints

`POST /api/net-worth/snapshot` supports manual or automatic snapshots and stores breakdown/warnings metadata when available. Locked snapshots cannot be overwritten unless an explicit `force=true` update is sent.

`POST /api/net-worth/recalculate`

```json
{ "from": "YYYY-MM", "to": "YYYY-MM", "include_current_month": false }
```

Recalculates unlocked monthly snapshots only, creates missing rows, skips locked months, and returns `{ recalculated, created, skipped_locked, warnings }`.

### Wealth FY cutover and AI extraction APIs (implemented)

- `POST /api/wealth/cutover/preview` accepts multipart `previous_tradebook`, optional `current_tradebook`, `mapping` JSON, `account_id`, optional `cutover_date` (default `2026-04-01`), and `aggregate_by_order`. It creates preview batches only; no final transactions, prices, assets, accounts, or movements are committed.
- `POST /api/wealth/cutover/:preview_id/commit` commits the generated opening `transfer_in` rows first and current-FY rows afterward by reusing the normal Wealth import commit engine. No movements are created.
- `POST /api/wealth/ai-import/extract` sends one supported document to OpenAI for structured extraction only. Supported initial files are PDF, PNG, JPG/JPEG, text/plain, and CSV only when broker-tradebook AI interpretation is explicitly selected. Defaults are 10 MB and 20 PDF pages where supported by validation. Raw file bytes are not retained.
- `GET /api/wealth/ai-imports`, `GET /api/wealth/ai-imports/:id`, and `DELETE /api/wealth/ai-imports/:id` manage user-scoped extraction records.
- `POST /api/wealth/ai-imports/:id/prepare` converts reviewed extraction data into the existing Wealth import preview format. The normal `/api/wealth/imports/:id/commit` endpoint remains the only commit path.

OpenAI is extraction-only. The API key must be configured server-side as a Cloudflare secret named `OPENAI_API_KEY`; optional variables are `OPENAI_DOCUMENT_MODEL`, `OPENAI_MAX_FILE_BYTES`, `OPENAI_MAX_PAGES`, and `OPENAI_REQUEST_TIMEOUT_MS`. Never include the key in frontend JavaScript, docs examples, API responses, logs, or database rows.

### Wealth market prices (Phase 7A)

- `GET /api/wealth/market-prices/status` returns market-price provider readiness and counts for eligible stock assets. It does **not** call the provider.
- `POST /api/wealth/market-prices/refresh` manually refreshes Indian stock prices for the authenticated user.
  ```json
  { "asset_ids": [1, 2, 3], "only_open_holdings": true, "force": false }
  ```
- Prices are end-of-day or delayed, not exchange-authorized realtime data. Twelve Data is currently supported through server-side configuration only: set `MARKET_DATA_PROVIDER=twelve_data` and a Cloudflare secret named `TWELVE_DATA_API_KEY`. Optional controls are `MARKET_DATA_TIMEOUT_MS`, `MARKET_DATA_MAX_SYMBOLS_PER_REFRESH`, and `MARKET_DATA_STALE_HOURS`.
- Supported scope is active `stock` assets on `NSE` or `BSE` with deterministic uppercase symbol/exchange mapping. Mutual funds, retirement assets, fixed deposits, loans, manual assets, and inactive assets are skipped.
- KoteCash does not scrape NSE/BSE websites, does not expose provider keys to frontend/API responses, and does not schedule automatic refreshes in Phase 7A.
- Price precedence: use the latest valid price on or before the valuation date; never use future prices; same-date market refresh may correct a market-sourced price; same-date manual/import prices are protected unless explicit force behavior is used; missing prices make valuation incomplete rather than zero; closed holdings do not require current prices.
- Request controls: refresh open holdings by default, deduplicate selected asset IDs, skip sufficiently fresh market prices, enforce the configured maximum asset count, apply timeout/retry-safe provider handling, and require one explicit user action.

### Market-price EOD provider workflow

KoteCash market prices are explicit user-triggered, end-of-day closing price updates only. The preferred provider is Marketstack via the server-side `MARKET_DATA_PROVIDER=marketstack` and `MARKETSTACK_API_KEY` configuration; Twelve Data remains available with `MARKET_DATA_PROVIDER=twelve_data` and `TWELVE_DATA_API_KEY` but is no longer the default. Provider API keys must never be emitted to browser JavaScript, JSON responses, logs, database rows, tests, or error details.

The market-price refresh API is `POST /api/wealth/market-prices/refresh`. It accepts `{ "asset_ids": [id], "only_open_holdings": false, "force": true }` for a single stock and can omit `asset_ids` to refresh eligible open stock assets. Refreshes use the latest completed EOD close, store rows in `investment_prices` with `source='market'`, preserve same-date manual/import prices unless forced, reject future dates, and never create transactions or movements. Status metadata is available from `GET /api/wealth/market-prices/status`.

Marketstack requests use `/v1/eod/latest?symbols=SYMBOL.XNSE,SYMBOL.XNSE&access_key=...` for batched EOD lookups. NSE is supported first through the documented Marketstack MIC suffix `XNSE`; BSE can be mapped explicitly with `XBOM`. Do not scrape NSE/BSE websites and do not use this workflow for live trading, intraday prices, or realtime claims. The data may be delayed and represents only completed EOD closes subject to provider coverage, plan limits, `MARKET_DATA_TIMEOUT_MS`, `MARKET_DATA_MAX_SYMBOLS_PER_REFRESH`, and `MARKET_DATA_STALE_HOURS`.

Provider symbol resolution is deterministic. Assets are checked by asset symbol, exchange, ISIN, asset type, and any configured row in `wealth_provider_symbols` (`asset_id`, `provider`, `provider_symbol`, `provider_exchange`, `verified_at`). If a symbol cannot be mapped confidently, return a row-level unsupported/error reason rather than guessing.

Manual fallback APIs are available for EOD CSV prices. `GET /api/wealth/market-prices/template` returns `symbol,exchange,isin,price_date,close,currency`. `POST /api/wealth/market-prices/import-csv` accepts multipart form data with `file` and optional `commit=true`. Preview validates up to 500 rows and creates no prices; commit writes valid rows as `source='import'`. CSV rows resolve owned assets by `asset_id`, then ISIN, then symbol + exchange; ambiguous matches, invalid/future dates, non-positive closes, duplicate asset/date rows, missing/unsupported currencies, and protected same-date manual/import prices are returned as row-level errors. CSV import never persists raw files and never creates transactions or movements.

### Wealth Portfolio Overview (Phase 8) — `GET /api/wealth/overview`
Returns a backend-calculated, dashboard-ready investment summary. Optional query parameters: `as_of=YYYY-MM-DD` and `account_id=<portfolio id>`.

Response sections:
- `summary`: `valuation_date`, `total_invested`, `current_value`, `market_holdings_value`, `other_investment_value`, `manual_or_retirement_value`, `realised_gain`, `unrealised_gain`, `total_gain`, `absolute_return_percent`, `xirr`, `xirr_status`, active/open/priced/missing/stale counts, `valuation_complete`, and UI-safe `warnings`. `current_value` is total Wealth investments, not holdings-only value.
- `valuation_health`: grouped status (`complete`, `partial`, `stale`, `unavailable`), priced/open/missing/stale counts, latest and oldest price dates, and readable `messages`.
- `top_gainers`, `top_losers`, `largest_holdings`, `largest_cost_allocations`, `realised_gain_contributors`, `missing_price_holdings`, `stale_price_holdings`: ranked open holdings using backend holding formulas.
- `allocations`: grouped by `asset`, `account`, `asset_type`, and `institution`, plus `unpriced_assets`.
- `gain_loss`: realised/unrealised/total gain and positive, negative, flat, and unpriced holding counts.
- `recent_transactions`: latest 10 investment transactions only.
- `warnings`: raw/debug warning codes retained for API diagnostics, not for the main UI.
- `investment_breakdown.provenance`: readable valuation provenance for non-holdings values such as EPF/manual accounts.

Allocation rules:
- Excludes inactive accounts, `include_in_net_worth=false` accounts, and closed holdings.
- Current-value percentages use only the priced portfolio current value as denominator.
- Unpriced open holdings are excluded from the current-value denominator but remain reported in `unpriced_assets` and allocation completeness.
- Invested percentages use total open holding cost basis where useful.

Partial valuation behavior:
- If some holdings are unpriced, `summary.current_value` is the priced partial value, not zero unless the priced value is actually zero.
- `valuation_complete=false`, missing counts are populated, and health messages explain that portfolio value is partial.
- APIs never intentionally serialize `NaN` or `Infinity`.

XIRR null behavior:
- `xirr` may be `null` when cash flows are insufficient or valuation is unsuitable; use `xirr_status` / route warnings to explain it. Do not display null XIRR as `0%`.

Ranking rules:
- Gainers and losers exclude holdings with missing current value.
- Ranking ties are deterministic by value, asset name, account name, asset id, and account id.

### Wealth Phase 9 manual and formula valuations

Supported Wealth account types are `brokerage`, `mutual_fund`, `epf`, `nps`, `ppf`, `ssy`, `fixed_deposit`, `gold`, `bond`, `crypto`, and `other`. Supported asset types are `stock`, `mutual_fund`, `epf`, `nps`, `ppf`, `ssy`, `fixed_deposit`, `gold`, `bond`, `crypto`, `cash_equivalent`, and `other`.

Valuation modes are `holdings`, `manual_snapshot`, `formula`, and `hybrid`. Holdings valuation uses investment transactions plus dated manual prices/NAVs. Manual snapshot valuation uses the latest `wealth_valuation_snapshots` row on or before the requested date. Formula valuation is available for fixed deposits and estimate-only PPF/SSY metadata when enough principal/rate/date information is supplied. Hybrid mode prefers complete holdings, then manual snapshots, then supported formula estimates, and returns readable warnings when fallback occurs.

Snapshot APIs:
- `GET /api/wealth/valuation-snapshots` with optional `account_id`, `asset_id`, `date_from`, `date_to`, and `latest_only` filters.
- `GET /api/wealth/valuation-snapshots/latest` returns latest snapshots per account/asset pair.
- `POST /api/wealth/valuation-snapshots` creates or explicitly corrects a same account/asset/date snapshot.
- `PUT /api/wealth/valuation-snapshots/:id` updates a user-owned snapshot.
- `DELETE /api/wealth/valuation-snapshots/:id` deletes a user-owned snapshot; historical net-worth snapshots keep already-calculated values.

Snapshot precedence avoids double counting: asset-level holdings are authoritative for holdings mode; asset-level snapshots are aggregated before account-level snapshots; account-level snapshots are only used as aggregate values when asset-level values are absent; formula values are used only for formula mode or configured hybrid fallback. Accounts with `include_in_net_worth=false` or inactive accounts are excluded from aggregation.

Fixed-deposit formulas support principal, annual interest rate, start date, maturity date, `simple`, `monthly`, `quarterly`, `half_yearly`, and `yearly` compounding, plus an optional maturity amount override. These are estimates only and not bank-authoritative. PPF/SSY formula behavior is a simple annual-compounding estimate only when sufficient metadata exists; otherwise manual valuation is required.

Default stale valuation thresholds are: stocks and mutual funds with prices 7 days, EPF 120 days, NPS 45 days, PPF 120 days, SSY 120 days, formula fixed deposits not stale while metadata is valid, manual fixed deposits 120 days, gold 30 days, and other manual assets 90 days. `WEALTH_MANUAL_VALUATION_STALE_DAYS` can override the global fallback default.

No automatic external integrations are provided for mutual-fund NAV, CAMS/KFintech, EPFO, NPS CRA, or market providers in this phase. Investment contributions, dividends, interest, and maturities do not automatically create Ledger movements; optional `movement_id` remains a reconciliation link only. Snapshot-only assets may show absolute gain but XIRR remains unavailable unless real dated cash flows and a terminal value exist.

## Phase 10 monthly net-worth snapshots

KoteCash now supports backend-generated monthly net-worth snapshots for historical reporting. Snapshots are reporting artifacts only; they do not create `movements`, Ledger expenses, Wealth transactions, or provider calls.

### Snapshot model

`net_worth_snapshots` keeps one user-scoped row per canonical `YYYY-MM` month. Phase 10 stores month/date aliases (`snapshot_month`, `snapshot_date`), backend totals (`assets_total`, `investments_total`, `cash_total`, `other_assets_total`, `liabilities_total`, `net_worth`), valuation health (`valuation_complete`, `valuation_status`, `priced_assets`, `missing_assets`, `stale_assets`), source/lock fields, a content hash, and `breakdown_json` for historical chart/table rendering.

### Generation endpoints

- `GET /api/net-worth/snapshots?date_from=&date_to=&year=&latest=&locked=` lists saved monthly snapshots and backend trend analytics.
- `GET /api/net-worth/snapshots/:month` returns one saved snapshot.
- `POST /api/net-worth/snapshots/generate` with `{ "month":"YYYY-MM", "force_recalculate":false }` creates or returns one month.
- `POST /api/net-worth/snapshots/preview-range` with `{ "start_month":"YYYY-MM", "end_month":"YYYY-MM" }` previews a controlled backfill.
- `POST /api/net-worth/snapshots/generate-range` with `{ "start_month":"YYYY-MM", "end_month":"YYYY-MM", "only_missing":true }` creates a confirmed range.
- `POST /api/net-worth/snapshots/:month/lock` locks a snapshot.
- `POST /api/net-worth/snapshots/:month/unlock` unlocks a snapshot.
- `DELETE /api/net-worth/snapshots/:month` deletes only an unlocked snapshot.

### Rules and limitations

- Future months are rejected.
- Snapshot date defaults to month end; the current month uses today's date until month end.
- Generation is idempotent. Existing unlocked rows are preserved unless recalculation is requested; locked rows are skipped and never silently replaced.
- Historical values use existing dated movements, historical Wealth transactions/prices, dated manual valuation snapshots, and formula valuations as of the snapshot date.
- Missing historical prices or valuations produce partial snapshots with readable health details rather than fabricated values.
- Current values are not reused for past months except legacy/manual valuation fallbacks already exposed by the shared Wealth valuation service.
- No general liability CRUD exists yet; liabilities are limited to existing credit-card and cicilan-derived values until Phase 11.
- Optional Cloudflare cron can call the generation endpoint for the previous completed month, but cron is not required; manual generation/backfill is available now.

## Phase 11 Liability APIs

Phase 11 adds `/api/liabilities` as the normalized debt module for loans, credit cards, BNPL, overdrafts, informal loans, payments, balance snapshots, and net-worth subtraction. Ordinary spending and income remain in `/api/movements`; investment transactions remain in the Wealth APIs.

### Liability model

`POST /api/liabilities` creates a user-scoped liability without creating a Ledger movement. Supported `liability_type`: `home_loan`, `personal_loan`, `vehicle_loan`, `education_loan`, `gold_loan`, `business_loan`, `credit_card`, `bnpl`, `overdraft`, `informal_loan`, `other`. Supported `interest_type`: `reducing`, `flat`, `simple`, `revolving`, `manual`. Supported `status`: `active`, `closed`, `settled`, `written_off`, `inactive`.

Key fields: `name`, `institution`, `account_number_masked`, `currency`, `original_principal`, `current_outstanding`, `interest_rate`, `interest_type`, `emi_amount`, `repayment_frequency`, `start_date`, `maturity_date`, `next_due_date`, `payment_day`, `include_in_net_worth`, `auto_calculation_mode`, `linked_wallet_id`, `linked_category_id`, `notes`, and `metadata_json`. Credit cards additionally accept `credit_limit`, `statement_balance`, `available_credit`, `statement_date`, `due_date`, `minimum_due`, and `full_payment_amount`.

### Payment model and movement linking

`POST /api/liabilities/:id/payments` records a liability payment without creating a Ledger movement. Supported `payment_type`: `emi`, `part_payment`, `prepayment`, `interest_only`, `fee`, `penalty`, `refund`, `adjustment`, `settlement`. Supported `source`: `manual`, `linked_movement`, `import`, `generated_schedule`, `migration`.

Use optional `movement_id` to link an existing Ledger movement. The API validates same-user ownership and prevents the same movement from being linked to more than one liability payment. Deleting a liability payment does not delete the linked movement, so the Ledger expense/cashflow is not duplicated.

Update and delete payment records with `PUT /api/liability-payments/:id` and `DELETE /api/liability-payments/:id`.

### Balance snapshots

`POST /api/liabilities/:id/balance-snapshots` records a manual/opening/reconciliation balance for a date. Same user/liability/date inserts are corrected in place. Future snapshots are ignored by as-of valuation. Update and delete with `PUT /api/liability-balance-snapshots/:id` and `DELETE /api/liability-balance-snapshots/:id`.

### Calculation modes

`auto_calculation_mode` controls valuation:

- `manual`: latest balance snapshot on or before the as-of date, falling back to stored outstanding with a warning.
- `payment_based`: original principal less principal repayments and adjustments.
- `amortization`: estimated payment-based/amortization valuation.
- `hybrid`: latest manual balance snapshot first, then payment-based estimate with a readable fallback warning.

Loan schedules returned by `GET /api/liabilities/:id/schedule` are estimates only and are not lender-authoritative. Reducing, flat, and simple interest are supported for weekly, fortnightly, monthly, quarterly, and yearly repayment frequencies where sufficient fields are present.

### Credit-card behavior

Credit cards are liabilities with `liability_type=credit_card`, card/institution fields, limit, statement balance, current outstanding, statement date, due date, minimum due, full payment amount, and interest rate. The API reports utilization and due status. Revolving interest is not generated automatically; Ledger card purchases remain ordinary `/api/movements` rows and are not converted into liability payments.

### Summary, Net Worth, and snapshots

`GET /api/liabilities/summary` returns total outstanding, original principal, principal repaid, interest and fees paid, EMI commitment, next-30-day items, overdue amount, active count, credit-card utilization, highest-interest liability, earliest maturity, payoff progress, and null ratios where data is insufficient.

Net Worth subtracts active `include_in_net_worth=true` Phase 11 liabilities as of the selected date using latest valid snapshots/payments/estimates. Monthly net-worth snapshots preserve locked rows, exclude future payments/snapshots, and store liability category breakdowns for home loans, personal loans, vehicle loans, education loans, credit cards, BNPL, and other liabilities.

### Deletion safeguards

`DELETE /api/liabilities/:id` permanently deletes only liabilities with no payments, balance snapshots, linked movements, snapshot dependencies, or import references. If dependencies exist, the liability is soft-deactivated and a dependency report is returned.

## Phase 12 Financial Goals & Planning

KoteCash now exposes normalized financial-goal APIs under `/api/goals`. These goals are reporting and planning records only: creating or updating goals, links, scenarios, or contributions **does not** create Ledger movements, investment transactions, liability payments, or Net Worth changes.

### Goal model
`POST /api/goals` accepts:
```json
{
  "name": "Emergency fund",
  "goal_type": "emergency_fund",
  "target_amount": 300000,
  "target_date": "2027-01-01",
  "current_manual_amount": 50000,
  "funding_mode": "hybrid",
  "priority": "high",
  "status": "active",
  "start_date": "2026-07-15",
  "inflation_rate": 6,
  "expected_return_rate": 5,
  "monthly_contribution_override": 10000,
  "include_existing_assets": true,
  "notes": "Planning estimate",
  "metadata_json": { "average_essential_monthly_expenses": 50000, "desired_coverage_months": 6 }
}
```
- `goal_type`: `emergency_fund`, `retirement`, `child_education`, `home_purchase`, `vehicle_purchase`, `debt_payoff`, `vacation`, `wedding`, `major_purchase`, `custom`.
- `funding_mode`: `manual`, `linked_assets`, or `hybrid`.
- `priority`: `high`, `medium`, or `low`.
- `status`: `active`, `paused`, `completed`, or `cancelled`.
- Target amount must be positive; manual current amount cannot be negative; target date cannot be before start date; rates must be finite and within validation bounds.
- Completing a goal preserves `completed_at`.

### Goal endpoints
- `GET /api/goals` supports filters: `goal_type`, `status`, `priority`, `target_before`, `behind_only=true`, `completed=true`.
- `POST /api/goals`, `GET /api/goals/:id`, `PUT /api/goals/:id`, `DELETE /api/goals/:id`.
- `GET /api/goals/:id/progress` returns backend-calculated progress and planning details.
- `GET /api/goals/summary` returns active/completed counts, funded and remaining totals, on-track/behind counts, monthly contribution totals, emergency-fund coverage, debt-payoff progress, and allocation warnings.

### Goal links
- `GET /api/goals/:id/links`
- `POST /api/goals/:id/links`
- `PUT /api/goal-links/:id`
- `DELETE /api/goal-links/:id`

Create a link with one reference only:
```json
{ "link_type": "wealth_account", "account_id": 4, "allocation_percent": 50 }
```
```json
{ "link_type": "wealth_asset", "asset_id": 9, "fixed_allocation_amount": 100000 }
```
```json
{ "link_type": "liability", "liability_id": 2 }
```
Ownership is validated. Allocation percent must be 0–100. Duplicate links are blocked by schema constraints. Account and asset values use backend wealth valuation services; debt-payoff liability links use current outstanding from liability calculation. Missing linked values are reported as missing and are not silently treated as zero. If allocations for the same linked account/asset exceed 100% across goals, progress responses include a warning.

### Progress rules
Savings-style goals calculate current funded amount from linked allocated asset values plus manual amount when `funding_mode` permits it. Debt-payoff goals calculate progress as starting debt minus current outstanding. Responses include target, current, remaining, displayed progress percent clamped to 0–100, overfunding amount, elapsed percent where dates exist, expected amount by today, ahead/behind amount, status, valuation completeness, missing/stale linked values, calculation date, warnings, inflation estimate, and monthly plan. The browser should display these backend values rather than recompute them.

### Inflation assumptions
Inflation estimates are available for `retirement`, `child_education`, `home_purchase`, `wedding`, and `major_purchase` when both target date and user-provided inflation rate exist. The original target is not overwritten. Results are labeled estimates and use compound annual inflation with partial-year support.

### Monthly contribution planning
`POST /api/goals/:id/calculate-plan` returns an estimated monthly contribution, months remaining, future value of current corpus, expected target amount, assumptions, and status. It supports zero-return and expected-return calculations plus `monthly_contribution_override`. Status can be `calculated`, `already_funded`, `target_date_passed`, or `missing_target_date`. Treat these as planning estimates, not guaranteed financial advice.

### Scenario planning
`POST /api/goals/:id/scenarios` compares up to three scenarios with inputs such as target amount, target date, current amount, monthly contribution, expected return, and inflation rate. It returns projected amount, projected shortfall/surplus, required contribution, and assumptions. KoteCash does not run Monte Carlo simulation and does not guarantee returns.

### Goal contributions
- `GET /api/goals/:id/contributions`
- `POST /api/goals/:id/contributions`
- `PUT /api/goal-contributions/:id`
- `DELETE /api/goal-contributions/:id`

Contribution sources: `manual`, `linked_movement`, `linked_investment`, `import`, `adjustment`. Linked movement and investment transaction ownership is validated. The same source record cannot be linked twice to the same goal. Deleting a contribution never deletes its source movement or transaction.

### Emergency-fund behavior
Emergency-fund metadata can include `average_essential_monthly_expenses` and `desired_coverage_months` (commonly 3, 6, 9, or 12). Progress includes current coverage months, target coverage months, shortfall, and status. KoteCash only uses linked liquid accounts/assets selected by the user; it does not automatically classify all investments as liquid.

### Retirement and debt-payoff behavior
Retirement goals support user-entered inflation and return assumptions plus links to retirement-designated wealth accounts/assets such as EPF, NPS, PPF, mutual funds, stocks, fixed deposits, and other retirement assets. Projections are estimates and do not include tax or withdrawal strategy.

Debt-payoff goals link liabilities and report starting debt, current outstanding, amount repaid, scheduled monthly payments, and the highest-interest liability. They do not modify liability schedules and do not create payments.

### Deletion safeguards
Deleting a goal with links or contributions cancels it and returns a dependency report. Permanent deletion is only allowed when no links, contributions, historical references, or import references exist. Linked accounts, assets, liabilities, movements, and investment transactions are never deleted by goal deletion.

## PennyWise SMS integration APIs

KoteCash exposes a reviewable PennyWise ingestion surface under `/api/integrations/pennywise`. All endpoints require the existing KoteCash authentication model: browser session cookies or `Authorization: Bearer kote_...` API tokens. API tokens are never returned after creation and must not be logged by clients.

### Preview approved candidates

`POST /api/integrations/pennywise/preview`

Use this before sync to validate user-reviewed SMS transactions and surface duplicate warnings. Preview never creates movements or sync records.

Request body:

```json
{
  "client_id": "stable-device-or-app-id",
  "transactions": [
    {
      "client_transaction_id": "stable-local-id",
      "sms_fingerprint": "stable-normalized-hash",
      "transaction_date": "2026-07-15",
      "transaction_time": "10:30:00",
      "amount": 1250,
      "direction": "expense",
      "wallet_id": 1,
      "category_id": 2,
      "merchant": "Swiggy",
      "description": "UPI payment to Swiggy",
      "reference_number": "ref-123",
      "source": "sms",
      "metadata": { "sms_sender": "ICICIB" }
    }
  ]
}
```

Responses include per-row `normalized_direction`, `duplicate_status`, `validation_issues`, `supported`, `proposed_movement`, and `warnings`.

### Sync reviewed transactions

`POST /api/integrations/pennywise/movements`

Creates ordinary Ledger movements only for rows the Android user has approved. Batch size is limited to 100 transactions and rows are processed independently. Successful rows are not rolled back when another row fails.

Per-row statuses are `created`, `already_synced`, `possible_duplicate`, `validation_failed`, `mapping_missing`, and `server_error`. Retries are safe because KoteCash checks existing records by `(user_id, client_id, client_transaction_id)`, `sms_fingerprint`, and a normalized financial fingerprint made from date, amount, direction, wallet, reference number, and merchant.

Movement semantics:

- `expense`: creates one movement from the mapped wallet to outside KoteCash.
- `income`: creates one movement from outside KoteCash to the mapped wallet.
- `transfer`: creates a wallet-to-wallet movement only when both wallet mappings are supplied.
- Failed SMS notifications, investment SMS, OTPs, promotions, balance-only alerts, and non-financial messages do not create Ledger movements.
- PennyWise sync does not create Wealth transactions or liability payments automatically. Credit-card payments and loan EMI SMS can be represented only as ordinary Ledger movements according to explicit mappings, then linked or corrected later in KoteCash.

### Reconcile sync status

`GET /api/integrations/pennywise/status`

Optional query filters: `client_transaction_id`, `sms_fingerprint`, `from`, `to`, and `sync_status`. Use this after network timeouts to reconcile whether KoteCash already created a movement.

### Security and storage constraints

Clients must send normalized fields, stable hashes, and masked account identifiers only. KoteCash rejects raw SMS body fields and stores no API tokens, secrets, or raw SMS text in `pennywise_sync_records`. Wallets and categories are ownership-validated for the authenticated user.

## Statement Imports (Phase 15)

KoteCash supports reviewed CSV statement-import workflows through `/api/imports` and `/api/import-templates`. The workflow is: upload → detect format → map columns → preview → validate → match existing records → resolve duplicates → commit → reconcile → roll back.

Supported import types are `bank_statement`, `credit_card_statement`, `loan_statement`, `mutual_fund_statement`, `epf_statement`, `nps_statement`, `generic_ledger`, `generic_valuation`, and `generic_liability`.

### Import APIs

- `POST /api/imports/upload` accepts multipart CSV uploads up to 5 MB. It validates file type, computes a deterministic hash, detects headers, suggests an import type and mapping, stores masked row evidence, and rejects duplicate active file hashes.
- `POST /api/imports/:id/mapping` saves user-confirmed column mapping, date format, amount convention, wallet/category defaults, opening/closing balances, and optionally saves a reusable template. Uploaded statement data is not stored inside templates.
- `POST /api/imports/:id/preview` and `POST /api/imports/:id/validate` normalize rows, validate required date/amount/direction fields, detect duplicates, match existing movements/PennyWise records, and return reconciliation data.
- `POST /api/imports/:id/commit` is idempotent at the row level. Bank, credit-card, and generic ledger rows can create Ledger movements only after mapping is valid. Probable/possible duplicates and matched existing rows are skipped unless the row is explicitly resolved as import-as-new. Loan/generic-liability rows can create liability payments only when a liability is explicitly supplied.
- `POST /api/imports/:id/rollback` deletes only records created by that batch. It never deletes pre-existing matched records, PennyWise-linked records, user-created records, or records from another batch. If later dependencies block rollback, the API returns a dependency report.
- `GET /api/imports`, `GET /api/imports/:id`, `GET /api/imports/:id/rows`, and `GET /api/imports/:id/reconciliation` inspect history, rows, and reconciliation.

### Import templates

- `GET /api/import-templates` returns built-in generic templates plus user templates.
- `POST /api/import-templates`, `PUT /api/import-templates/:id`, and `DELETE /api/import-templates/:id` manage user-defined mapping templates.
- Template fields include name, institution, import type, column mapping, date format, amount convention, header row, rows to skip, account mapping, wallet/category defaults, and active status.

### Duplicate detection and matching

Duplicate statuses are `new`, `exact_duplicate`, `probable_duplicate`, `possible_duplicate`, `matched_existing`, and `conflict`. Matching considers date, amount, direction, wallet/account, normalized description, reference, existing Ledger movements, and PennyWise-linked movements. Confidence values are `exact`, `high`, `medium`, `low`, and `unmatched`; low-confidence matches are not auto-linked.

### Reconciliation

Bank-style reconciliation calculates `expected_closing = opening_balance + imported_credits - imported_debits`, then compares it with the statement closing balance. Status is `reconciled`, `small_difference`, `unreconciled`, or `insufficient_data`. Credit-card and liability statements use the same reviewed summary pattern but do not modify balances or create snapshots automatically.

### Privacy and unsupported formats

CSV, UTF-8 CSV, BOM-prefixed CSV, CRLF/LF, quoted commas, multiline quoted cells, debit/credit columns, signed amounts, and separate amount/direction conventions are supported. XLSX, password-protected PDF, PDF OCR, bank API connections, scraping, email ingestion, and AI-only automatic imports are not supported in Phase 15. Account numbers and sensitive references are masked; passwords, OTPs, CVVs, PINs, and secrets are redacted.

### Unified Financial Dashboard (Phase 16)

- `GET /api/dashboard/financial-overview?as_of=YYYY-MM-DD&month=YYYY-MM&trend_months=6&currency=IDR` returns a mobile-first dashboard payload assembled from existing backend services and module summaries.
- The endpoint is authenticated and user-scoped. It does not create Ledger movements, Wealth transactions, liability payments, goal contributions, imports, PennyWise records, or Net Worth snapshots while loading.
- Top-level sections are: `net_worth`, `cash_flow`, `wealth`, `liabilities`, `goals`, `budgets`, `alerts`, `upcoming`, `imports`, `pennywise`, `recent_activity`, `health`, `section_errors`, and `meta`.
- `net_worth` clearly separates `current_live_net_worth` from stored snapshot fields such as `latest_locked_snapshot_net_worth`, `latest_snapshot_month`, and historical `trend`. Month-on-month and YTD comparisons are `null` when snapshot history is unavailable.
- `cash_flow` reuses Phase 14 definitions: ordinary Ledger income/expenses exclude internal transfers, debt payments are separate, and investment contributions are separate from consumption spending.
- `wealth` reuses Wealth Overview/performance values and returns valuation completeness, XIRR, open holdings, top holding/gainer/loser, and allocation summary. Missing or non-finite values are returned as `null`.
- `liabilities`, `goals`, and `budgets` are compact summaries using existing liability, goal progress, and budget/cash-flow calculations. Linked liability payments and internal transfers are not double-counted as ordinary expenses.
- `alerts.items` is a deterministic ranked attention feed. Severity order is `critical`, `high`, `medium`, `low`, `info`. Duplicate underlying issues are deduplicated by dashboard keys before sorting. `alerts.initial_items` contains the first five items for the Home screen.
- `upcoming` contains only dated items already available in source modules and defaults to a 30-day horizon. It does not invent due dates.
- Import health includes latest batch, unresolved rows, failed rows, unreconciled batches, rolled-back batches, and latest successful import. PennyWise health includes last sync, pending-review count, approved-ready count, failed count, duplicate count, and connection status.
- `recent_activity` is a navigation feed labelled by source type; it is not an accounting stream and must not be used to compute financial totals.
- `health` indicators are deterministic statuses (`good`, `watch`, `attention`, `unavailable`) with concise explanations, supporting metrics, and destination paths. They are not professional or personalized financial advice.
- Partial failure behavior: independent sections are loaded in parallel where safe. If a non-critical section fails, the endpoint returns the remaining sections plus `section_errors.<section>` and `meta.partial: true`; it does not log financial payloads.
- Freshness rules: dashboard data health surfaces stale or missing valuations, unresolved imports, PennyWise sync failures, and unavailable snapshot comparisons through attention items and health indicators rather than raw internal timestamps.
- Navigation structure remains compact: Home/Dashboard links to full modules instead of duplicating full tables. Mobile primary navigation should keep Home, Ledger, Wealth, and More-style access to Budget, Liabilities, Goals, Net Worth, Imports, PennyWise, and Settings according to the current app conventions.

---

## Phase 17 — Account balance reconciliation APIs

KoteCash now supports explicit wallet opening balances, dated account balance snapshots, as-of balance calculation, and account reconciliation sessions. These APIs are backend-calculated; clients must not derive financial totals on the frontend.

### Account balance snapshots

`account_balance_snapshots` stores one user-scoped wallet snapshot per wallet/date/source. Fields include `wallet_id`, `snapshot_date`, `balance`, optional available/ledger balances, `currency`, `source`, optional statement period, optional `import_batch_id`, external reference, notes, and `is_reconciled`.

Supported `source` values: `manual`, `statement`, `import`, `opening_balance`, `migration`, and `reconciliation_adjustment`.

Endpoints:

- `GET /api/account-balances/snapshots?wallet_id=` lists snapshots.
- `POST /api/account-balances/snapshots` creates a snapshot. Future dates and non-finite amounts are rejected. Snapshot creation never creates Ledger movements.
- `PUT /api/account-balances/snapshots/:id` explicitly corrects a snapshot.
- `DELETE /api/account-balances/snapshots/:id` deletes only the snapshot, never movements.

Opening balances are represented as `source:"opening_balance"` snapshots. They are not income, not expenses, and are excluded from cash-flow and budget analytics because no ordinary Ledger movement is created.

### As-of wallet balance

`GET /api/wallets/:id/balance-as-of?as_of=YYYY-MM-DD` returns the shared backend wallet balance calculation:

`expected_balance = opening_balance + credits − debits + incoming_transfers − outgoing_transfers ± reconciliation_adjustments`.

The response includes totals, latest actual snapshot, reconciliation difference/status, valuation source details, and warnings such as missing opening balance or transactions before the opening date. Future movements are excluded by the `as_of` cutoff. Internal transfers are not income or expenses but do affect wallet balance.

### Account reconciliations

`account_reconciliations` stores a wallet statement-period session with period dates, opening balance, expected closing, statement closing, difference, status, source, optional import batch, lock timestamps, notes, and historical counts. Supported statuses: `draft`, `in_review`, `reconciled`, `small_difference`, `unreconciled`, `locked`, and `cancelled`.

`account_reconciliation_rows` stores row decisions and links back to existing Ledger movements and Phase 15 `financial_import_rows` where available. Row types include Ledger movement, imported statement row, balance adjustment, opening balance, unmatched statement row, and unmatched Ledger row. Match statuses are exact/probable/possible/unmatched/excluded/resolved, and resolutions include matching existing movements, importing as new later, skipping statement rows, marking Ledger rows valid, marking duplicates, creating adjustment rows, or unresolved.

Endpoints:

- `GET /api/account-reconciliations`
- `POST /api/account-reconciliations`
- `GET /api/account-reconciliations/:id`
- `PUT /api/account-reconciliations/:id`
- `DELETE /api/account-reconciliations/:id` cancels when unlocked and never deletes movements.
- `POST /api/account-reconciliations/:id/preview`
- `POST /api/account-reconciliations/:id/auto-match`
- `POST /api/account-reconciliations/:id/rows/:row_id/resolve`
- `POST /api/account-reconciliations/:id/reconcile`
- `POST /api/account-reconciliations/:id/lock`
- `POST /api/account-reconciliations/:id/unlock`
- `POST /api/account-reconciliations/:id/cancel`
- `POST /api/account-reconciliations/:id/adjustment-preview`
- `POST /api/account-reconciliations/:id/adjustment-commit`
- `GET /api/account-reconciliations/history`
- `GET /api/wallets/:id/reconciliation-status`

### Matching confidence and duplicates

Auto-match compares statement import rows with existing manual, PennyWise-created, and imported Ledger movements by wallet, amount, date window, direction, and references. Exact/high matches may be suggested. Lower confidence rows remain unresolved for review. A Ledger movement is only auto-linked once in a session unless a future split-transaction workflow explicitly supports one-to-many matching. Duplicate statuses are preserved from statement import rows and can be resolved without automatic deletion.

### Lifecycle, locking, and adjustments

Reconciliation preview calculates statement-period credits/debits/transfers and compares expected closing to statement closing. INR tolerance defaults to ₹1 for exact reconciliation and a small-difference band for minor residuals. Required missing balances prevent a clean reconciled status.

Locking preserves opening, closing, calculated totals, difference, matched row decisions, resolutions, adjustment rows, and final status. Locked sessions do not silently recalculate; unlock before changing row decisions or recalculating. Locking does not block unrelated future transactions.

Adjustments require preview and explicit confirmation. They are stored as reconciliation adjustment rows and clearly labeled; no automatic transaction deletion or hidden balancing entry is created.

### Integrations and limitations

Phase 15 statement import batches can seed reconciliations via `import_batch_id`; imported rows are reused rather than duplicated. Rollback deletes only import-created balance snapshots and updates reconciliation row links safely. Locked reconciliations block unsafe rollback and return dependency details.

PennyWise-created movements are matched like normal Ledger movements while preserving movement provenance. Reconciliation must not duplicate PennyWise movements.

Budget and cash-flow reports remain based on ordinary Ledger movements: opening balances are snapshots, transfers are excluded from income/expense, and adjustment classification is explicit. Net Worth should use the as-of balance service for wallet values and must not count both calculated balances and snapshots twice. If credit cards are also liabilities, outstanding debt remains liability-side; card wallet reconciliation confirms purchases/payments but does not inflate assets or update liabilities without explicit user confirmation.

Known limitations: no direct bank APIs, browser scraping, automatic statement downloads, automatic transaction deletion, tax calculation, or full reconciliation report export.

### Income planning APIs (Phase 20)

KoteCash tracks expected income separately from the Ledger. **Actual income still comes only from `movements`** where money flows from outside into an owned account. Creating an income source or expected occurrence never creates a Ledger movement.

- **Income sources**: `GET /api/income-sources`, `POST /api/income-sources`, `GET /api/income-sources/:id`, `PUT /api/income-sources/:id`, `DELETE /api/income-sources/:id`.
  - `income_type`: `salary`, `freelance`, `business`, `rental`, `interest`, `dividend`, `pension`, `government_benefit`, `bonus`, `reimbursement`, `refund`, or `other`.
  - `amount_variability`: `fixed`, `variable`, or `irregular`.
  - `frequency`: `weekly`, `fortnightly`, `monthly`, `quarterly`, `half_yearly`, `yearly`, `irregular`, or `one_time`.
  - Linked wallets and categories must belong to the authenticated user. Expected amounts must be finite and non-negative. Deleting a source with occurrences or matches archives it and returns a dependency report.
- **Salary fields and versioning**: salary sources may include `employer`, `salary_account`, `expected_gross_credit`, `expected_net_credit`, `salary_day`, `payroll_frequency`, fixed/variable components, bonus month, reimbursement behavior, and effective dates. Updates with effective dates append `income_source_versions`, so historical expected amounts are not overwritten.
- **Expected occurrences**: `GET /api/income-sources/:id/occurrences`, `POST /api/income-sources/:id/generate-schedule`, `PUT /api/income-occurrences/:id`, and `DELETE /api/income-occurrences/:id`. Schedule generation is idempotent through a deterministic `occurrence_key` and bounded to avoid unbounded future rows. Occurrences may be `expected`, `due_soon`, `due_today`, `received`, `partially_received`, `overdue`, `skipped`, `cancelled`, or `unmatched`.
- **Matching and reconciliation**: `GET /api/income-occurrences/:id/candidates`, `POST /api/income-occurrences/:id/match`, and `POST /api/income-occurrences/:id/unmatch`. Matching links existing Ledger credits only; it never duplicates income or changes movement amounts. Confidence is based on amount, date, wallet, category, payer/description, and reference text (`exact`, `high`, `medium`, `low`, `unmatched`). Low confidence must be manually reviewed.
- **Split and combined receipts**: matches are stored as allocation rows. One expected occurrence can be allocated across multiple Ledger credits, and one Ledger credit can be allocated across multiple expected components, as long as total allocations do not exceed the movement amount.
- **Summary and forecasts**: `GET /api/income/summary?month=YYYY-MM`, `GET /api/income/forecast?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&scenario=conservative|base|optimistic`, and `GET /api/income/trends`. Forecasts return expected income, actual income, overdue expected income, salary/variable/one-time/recurring breakdowns, variance, realization percentage, next expected credit, source count, concentration, completeness, and warnings. Nulls are returned when data is insufficient.
- **Classification rules**: salary, freelance, business, rental, pension, government benefits, bonus, interest, and dividends are visible in income planning. Reimbursements, refunds, loan proceeds, transfers, and investment redemptions are excluded from clean earned-income and savings-rate calculations unless a user deliberately classifies data differently through categories.
- **Savings-rate treatment**: clean savings amount is `earned and passive income − ordinary expenses − debt payments`; savings rate is null for zero clean-income months. Investment contributions remain separate.
- **Expected cash-flow calendar**: `GET /api/cash-flow/expected-calendar?days=30|60|90` returns upcoming expected income items with date, title, inflow/outflow, confidence, source link, status, and destination path. The endpoint is read-only and does not create movements.
- **Dashboard and Budget integration**: `/api/dashboard` includes an `incomePlanning` compact summary. Budget and cash-flow services keep actual Ledger cash flow separate from expected income and use clean-income exclusions for refunds, reimbursements, loan proceeds, transfers, and investment redemptions.
- **PennyWise/import integration**: imported and PennyWise-created reviewed Ledger credits can be candidate matches. Source provenance on the Ledger movement is preserved.
- **Known limitations**: no payroll deductions, tax withholding, employer integrations, bank API connections, automatic movement creation, financial advice, or automatic category rewriting.

### Family, household ownership, and shared expenses (Phase 22)
KoteCash supports one authenticated owner managing a private household. Family members do **not** receive login accounts, invitations, roles, or shared workspaces.

- Households: `GET /api/households`, `POST /api/households`, `GET /api/households/:id`, `PUT /api/households/:id`.
- Members: `GET /api/households/:id/members`, `POST /api/households/:id/members`, `GET /api/household-members/:id`, `PUT /api/household-members/:id`, `DELETE /api/household-members/:id`. Delete archives members when financial dependencies exist.
- Ownership: `GET /api/ownership`, `POST /api/ownership`, `PUT /api/ownership/:id`, `DELETE /api/ownership/:id`, `POST /api/ownership/preview`, `POST /api/ownership/apply`.
- Shared expenses: `GET /api/movements/:id/allocations`, `POST /api/movements/:id/allocations`, `PUT /api/movement-allocations/:id`, `DELETE /api/movement-allocations/:id`.
- Summaries: `GET /api/household/summary`, `GET /api/household/members/:id/summary`, `GET /api/household/net-worth`, `GET /api/household/cash-flow`, `GET /api/household/ownership-health`.

Ownership records use `record_type` (`wallet`, `wealth_account`, `wealth_asset`, `liability`, `goal`, `income_source`, `budget`, `insurance_policy_future`, `other_asset`), `ownership_type` (`individual`, `joint`, `household`, `custodial`, `beneficiary`, `shared_expense`), and `allocation_basis` (`percentage`, `equal`, `full`, `informational`). Existing records with no explicit ownership resolve safely as the Self member at 100%, preserving IDs, Ledger movements, and historical values. Beneficiary rows are informational for present net worth. Shared expense allocations split an existing movement without changing or duplicating the original Ledger movement.
