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

### Budgets
- `POST /api/budgets` → `{ category_id, budget_amount, month ("YYYY-MM") }`
- `GET /api/budgets?month=2026-06` → each row includes computed `actual`, `remaining`, `status` (`UNDER`/`ON TRACK`/`OVER`)
- Debt-service categories are auto-excluded

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
