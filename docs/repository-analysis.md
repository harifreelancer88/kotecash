# KoteCash Repository Analysis

This document records the current architecture and behavior of the KoteCash web application before adding a future Personal Wealth module. It is intentionally descriptive: it does not propose schema changes as if they already exist, and it does not introduce implementation work.

## 1. Architecture Summary

KoteCash is a single Cloudflare Worker application that combines:

- **Astro SSR pages** for `/`, `/login`, `/ai`, and the catch-all API adapter.
- **Hono REST API** mounted under `/api/*`.
- **Cloudflare D1 SQLite database** managed by SQL migrations in `db/migrations`.
- **Static browser app** in `public/app.js`, which renders most authenticated screens as a small client-side SPA inside the Astro layout.
- **Tailwind + DaisyUI + custom CSS variables** for UI styling.
- **Vitest** for formula and route unit tests.

The key domain decision is the **universal `movements` ledger**. Every cash/event flow is modeled as a positive amount moving from a source endpoint to a destination endpoint. A null source means money came from outside the system; a null destination means money left the system. Current balances, monthly P&L, budgets, and net worth are derived from this ledger plus account base values and portfolio/deposit/card snapshots.

## 2. Important Folders and Files

| Path | Purpose |
| --- | --- |
| `src/pages/` | Astro route entrypoints. `index.astro` renders the authenticated shell, `login.astro` renders login, `api/[...path].ts` forwards API requests to Hono, and `ai.ts` serves the AI skill markdown. |
| `src/layouts/Layout.astro` | Global HTML shell, script includes, sidebar/mobile nav placement, and `#pageContent` mount point for the client app. |
| `src/components/` | Astro navigation components: desktop sidebar and mobile bottom navigation. |
| `src/server/app.ts` | Main Hono app: public auth routes, protected middleware, account route, and all resource router mounts. |
| `src/server/routes/` | API resource modules for dashboard, movements, wallets, cicilan, misc assets, manage resources, net worth, recurring, tokens, and legacy transactions. |
| `src/server/middleware/auth.ts` | Auth middleware supporting bearer API tokens and cookie sessions. |
| `src/server/formulas.ts` | Shared financial calculation helpers and pure domain functions. |
| `src/server/types.ts` | Hono binding/variable types and date helper. |
| `public/app.js` | Main authenticated UI SPA: state hydration, routing, page renderers, charts, modal forms, and API mutation handlers. |
| `public/chart.umd.min.js` | Vendored Chart.js bundle loaded by the layout. |
| `src/styles/globals.css` | Theme tokens and shared component styles. |
| `db/migrations/` | D1 schema evolution. Migration names are numeric and ordered. |
| `db/seed.sql` | Optional demo data seed. |
| `docs/SKILL.md` | API reference/skill for AI agents; also served at `/ai`. |
| `tests/` | Vitest tests for formulas, auth, movements, recurring dates, and backfill acceptance. |
| `wrangler.toml` | Cloudflare Worker and D1 binding configuration. |
| `package.json` | Build/test/deploy scripts and dependencies. |

## 3. Build System and Runtime

### Runtime stack

- **Astro 4** is configured with the Cloudflare adapter.
- **Hono** owns all REST endpoints.
- **D1** is provided through the `DB` binding.
- **Cloudflare Worker deployment** is managed by Wrangler.
- **Chart.js** is loaded in the browser from `public/chart.umd.min.js`.
- **Lucide icons** are used both via `lucide-astro` in Astro components and via a CDN script for client-rendered icon placeholders.

### Scripts

- `npm run dev` / `npm start`: local Astro dev server.
- `npm run build`: Astro build.
- `npm run preview`: Astro preview.
- `npm run db:migrations:apply`: applies D1 migrations remotely using the `DB` binding name.
- `npm run deploy`: applies migrations and deploys with Wrangler.
- `npm test`: runs Vitest.

### Deployment assumptions

The application is designed as a same-origin app: pages and `/api/*` live in the same Worker, so there is no CORS layer. API calls use cookies in the browser and bearer tokens for AI/automation clients.

## 4. Frontend Structure

### Astro shell and routing

The only authenticated web page route is `/`, rendered by `src/pages/index.astro`. It passes control to `Layout.astro`, which renders the sidebar, mobile bottom nav, and a `#pageContent` placeholder. `public/app.js` then hydrates all data and renders the selected logical page based on `?page=`.

`/login` is a separate bare layout page with its own inline submit handler. `/ai` returns markdown from `docs/SKILL.md` for AI integration.

### Client-side app state

`public/app.js` uses global mutable state rather than a framework store. The main state object is `M`, with arrays/properties for income, expense, wallets, cards, deposits, portfolios, cicilan, transactions, net worth, goals, earmarks, budgets, categories, and recurring templates.

Lookup maps (`WMAP`, `DMAP`, `PMAP`, `GMAP`, `CATMAP`) map user-visible names to IDs for form submissions. This name-based resolution is convenient but can become ambiguous if duplicate names are allowed.

### Data loading

`loadAll()` fetches these endpoints in parallel:

- `/api/categories`
- `/api/wallets`
- `/api/credit-cards`
- `/api/deposits`
- `/api/portfolios`
- `/api/cicilan`
- `/api/goals`
- `/api/budgets`
- `/api/transactions`
- `/api/dashboard`
- `/api/net-worth`
- `/api/recurring`

The responses are reshaped into the legacy/mockup-oriented `M` format. After mutations, `reload(page)` re-fetches everything and re-renders the current or requested page.

### Logical pages

The client router recognizes:

- `dashboard`
- `ledger`
- `stats`
- `categories`
- `budgets`
- `cicilan`
- `recurring`
- `networth`
- `scenarios`
- `creditcard`
- `assets`
- `wallets`
- `goals`
- `account`
- `api`

Navigation links are plain anchors with `data-page` and `href="/?page=..."`. A document click handler intercepts those links and performs in-place rendering via `history.pushState`.

### Layout and navigation

The desktop sidebar groups pages into:

- **CORE**: Dashboard, Ledger, Statistics.
- **MANAGE**: Categories, Budgets, Credit Card, Wallets, Cicilan, Recurring.
- **ANALYZE**: Net Worth, What-If, Goals, Assets.
- **SETTINGS**: Account, API & AI.

The mobile bottom nav exposes Home, Ledger, Stats, Debt, and a More overlay containing the remaining pages.

### Charts

Charts are created in `public/app.js` using the global `Chart` object. Existing chart areas:

- Statistics page: income/expense by category or summary charts.
- Net Worth page: 6-month assets/liabilities trend.
- What-If page: scenario chart for income/expense changes.

Before each navigation, existing chart instances are destroyed to avoid duplicate canvas bindings.

### Reusable frontend helpers

The frontend uses hand-written helper functions rather than reusable component classes:

- `api()` wraps fetch with cookie credentials and redirects on 401.
- `fmt()`, `pct()`, `ordinal()` format numbers and dates.
- `healthBadge()` and `budgetBadge()` derive badge UI states.
- `openModal()`, `closeModal()`, `fld()`, `inp()`, `sel()`, `saveBtn()` produce modal form markup.
- `toast()` displays lightweight feedback.
- Multiple `show...`, `save...`, `delete...` functions implement resource workflows.

## 5. Backend Structure

### Hono app composition

`src/server/app.ts` creates one Hono app. Public routes are defined first:

- `POST /api/auth/login`
- `POST /api/auth/logout`

Then `authMiddleware` protects all `/api/*` routes. After protection, the app defines:

- `GET /api/auth/me`
- `PUT /api/account/password`

Resource routers are mounted below `/api`, `/api/wallets`, `/api/movements`, etc.

### Types and context

All server routes use `Bindings` with a `DB: D1Database` and `Variables` with `userId: number`. The helper `userId(c)` exists but most routes call `c.get("userId")` directly. `currentMonth()` returns the runtime current month in `YYYY-MM` format.

### Authentication

Two authentication methods exist:

1. **Browser cookie session**
   - Login checks `users.email` and unsalted SHA-256 password hash.
   - A successful login sets an HTTP-only `session` cookie containing the numeric user ID.
   - Logout deletes the cookie.
   - If the users table is empty, login auto-creates `admin@example.com` / `admin`.

2. **Bearer API token**
   - `Authorization: Bearer kote_...` is SHA-256 hashed and matched against `api_tokens.token_hash`.
   - On success, `last_used_at` is updated.
   - The raw token is returned only when generated.

There is a local-development fallback that accepts `session=1` if the user lookup fails.

## 6. Database Schema

All tables are user-scoped through `user_id` except historical legacy tables that were dropped and relationship references like `wallet_transactions` that no longer exist after migration `0004`.

### `users`

Purpose: login identities.

Important columns:

- `id`: primary key.
- `email`: unique login email.
- `password_hash`: unsalted SHA-256 hash.
- `created_at`: creation timestamp.

Relationships/usage:

- Referenced by almost every user-owned table.
- Read by login, auth middleware, and `/api/auth/me`.
- Updated by `/api/account/password`.

### `categories`

Purpose: P&L classification for movements and budgets.

Important columns:

- `name`: category name.
- `type`: `income` or `expense`.
- `is_debt_service`: excludes fixed debt payment categories from regular budget queries.

Relationships/usage:

- Referenced by `movements.category_id`, `budgets.category_id`, and recurring templates.
- Categories can be deleted; existing movement category references are nulled by route logic.

### `wallets`

Purpose: liquid accounts such as banks, e-wallets, and cash.

Important columns:

- `name`
- `type`: `bank`, `e-wallet`, or `cash`.
- `account_number`
- `initial_balance`: base balance before movements.

Relationships/usage:

- Used in `movements` as `src_kind='wallet'` or `dst_kind='wallet'`.
- Used as earmark sources.
- Balance is derived with `accountBalance('wallet', id, initial_balance, movements)`.

### `cicilan`

Purpose: installment liabilities.

Important columns:

- `name`
- `total_utang`: original principal/amount owed.
- `monthly_payment`
- `tenor_bulan`
- `bunga_persen`
- `start_date`, `due_date`
- `status`
- `notes`

Relationships/usage:

- Payments are movements with `dst_kind='cicilan'`.
- Remaining balance (`sisa`) derives from original debt minus payments.
- `/api/cicilan/:id/schedule` uses amortization helper logic.

### `goals`

Purpose: savings targets.

Important columns:

- `name`
- `target_amount`
- `icon`

Relationships/usage:

- `earmarks.goal_id` points to goals.
- Progress is sum of earmarks, not actual account movement.

### `credit_cards`

Purpose: revolving credit-card liabilities.

Important columns:

- `name`
- `limit_amount`
- `balance`: base opening owed balance.
- `statement_day`, `due_day`
- `min_payment_pct`
- `interest_rate`
- `annual_fee`

Relationships/usage:

- Charges are modeled as `credit_card -> outside` movements.
- Payments are modeled as `wallet -> credit_card` movements.
- Current owed balance derives from base balance plus charges minus payments.
- Balance history exists for snapshots, although current route calculations mostly derive current balance from movements.

### `deposits`

Purpose: term deposits / fixed-income-like assets.

Important columns:

- `bank`
- `amount`: base principal.
- `rate`
- `tenor_months`
- `start_date`, `maturity_date`
- `status`
- `withdrawal_wallet_id`: added in migration `0003`, optional target wallet for withdrawals.

Relationships/usage:

- Deposits can be movement endpoints.
- Deposit current balance derives from base amount plus inbound principal minus withdrawals.
- Creation and updates append `balance_history` rows.
- Withdrawal can create a `deposit -> wallet` movement plus optional `outside -> wallet` interest income movement.

### `portfolios`

Purpose: investment portfolio accounts whose market value changes outside cash flows.

Important columns:

- `name`
- `value`: original/legacy value column.
- `updated_at`
- `last_snapshot_at`: added in migration `0003`.

Relationships/usage:

- Portfolio cash trades are movements between wallets and portfolios.
- Market value is tracked by `balance_history`, not by mutating the `value` column as the source of truth.
- `portfolioValue()` returns latest snapshot minus outflows since that snapshot.

### `net_worth_snapshots`

Purpose: stored monthly net-worth snapshots.

Important columns:

- `month`: `YYYY-MM`, unique per user.
- `assets`
- `liabilities`
- `net_worth`

Relationships/usage:

- `POST /api/net-worth/snapshot` upserts this table.
- Current `GET /api/net-worth` reconstructs trends from movements and balance history instead of reading this table.

### `api_tokens`

Purpose: long-lived bearer tokens for AI/API clients.

Important columns:

- `label`
- `token_hash`: SHA-256 hash, unique.
- `prefix`: display-only token prefix.
- `created_at`
- `last_used_at`

Relationships/usage:

- Auth middleware checks token hash and updates `last_used_at`.
- Token routes list, create, and revoke tokens.

### `budgets`

Purpose: monthly budget caps per category.

Important columns:

- `category_id`
- `budget_amount`
- `month`: `YYYY-MM`.
- Unique `(user_id, category_id, month)`.

Relationships/usage:

- Budget actuals are computed from movement expenses (`dst_kind IS NULL`) grouped by category.
- Categories marked `is_debt_service=1` are excluded from budget lists.

### `earmarks`

Purpose: virtual allocation of account balances toward goals without moving real money.

Important columns:

- `goal_id`
- `source_type`: `wallet`, `deposit`, or `portfolio`.
- `source_id`
- `amount`

Relationships/usage:

- Goal progress is sum of matching earmarks.
- Wallet free balance is wallet balance minus wallet-source earmarks.
- Overspending a wallet's free balance returns an earmark warning but still records the expense.

### `movements`

Purpose: universal money movement ledger and primary accounting source.

Important columns:

- `date`: `YYYY-MM-DD`.
- `amount`: positive integer IDR.
- `description`
- `category_id`
- `src_kind`, `src_id`
- `dst_kind`, `dst_id`
- `recurring_id`
- CHECK constraints enforce positive amounts, at least one endpoint, and kind/id null consistency.

Relationships/usage:

- Replaces legacy `transactions`, `wallet_transactions`, and `transfers` tables dropped in migration `0004`.
- Used by dashboard, wallets, budgets, cicilan, cards, deposits, portfolios, net worth, and transactions compatibility view.
- Indexed by user/date, source endpoint, destination endpoint, and recurring template.

### `recurring_templates`

Purpose: templates that materialize future movements.

Important columns:

- `frequency`: `monthly`, `yearly`, `weekly`, or `daily`.
- `day_of_month`, `month_of_year`, `weekday`
- `amount`
- `description`
- `category_id`
- `src_kind`, `src_id`, `dst_kind`, `dst_id`
- `next_run`
- `active`

Relationships/usage:

- Dashboard lazily sweeps due active templates into `movements`.
- `/api/recurring/sweep` can manually emit due movements.

### `balance_history`

Purpose: append-only value snapshots for entities whose value is otherwise destructive or market-driven.

Important columns:

- `entity_kind`: `portfolio`, `deposit`, or `credit_card`.
- `entity_id`
- `amount`
- `recorded_at`

Relationships/usage:

- Migration `0002` backfills one baseline snapshot for existing portfolios, deposits, and cards.
- Portfolio current value and net-worth trend use these snapshots.
- Deposit/card snapshot writes exist, but most current current-balance logic derives from base values and movements.

### Dropped legacy tables

Migration `0001` created `transactions`, `wallet_transactions`, and `transfers`, but migration `0004_drop_legacy_ledgers.sql` drops all three after the movements backfill. Existing code still has a **read-only `transactions` compatibility route** for frontend reads, but the current database no longer has those legacy tables.

## 7. API Summary

All routes below are under the same origin. All `/api/*` routes except login/logout are protected by cookie or bearer-token auth.

### Auth and account

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `POST` | `/api/auth/login` | `{ email, password }` | `{ success, user }` or `{ error }`; sets `session` cookie | `src/pages/login.astro` |
| `POST` | `/api/auth/logout` | none | `{ success: true }` | `public/app.js` `doLogout()` |
| `GET` | `/api/auth/me` | none | `{ user }` | Account page `loadAccountInfo()` |
| `PUT` | `/api/account/password` | `{ password }` | `{ success: true }` | Account page `changePassword()` |

### Dashboard and reporting

| Method | Route | Request/query | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/dashboard` | Optional `month=YYYY-MM` | Current-month P&L, balances, net worth, savings tier, DTI tier | `loadAll()` |
| `GET` | `/api/net-worth` | none | `{ snapshots: [{ month, assets, liabilities, netWorth }], delta }` | `loadAll()`, Net Worth chart |
| `POST` | `/api/net-worth/snapshot` | `{ month?, assets?, liabilities?, net_worth? }` | `{ success: true }` | Not called by current frontend |

### Movements and compatibility transactions

| Method | Route | Request/query | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/movements` | Optional `wallet_id`, `category`, `month`, `q` | Raw movement rows | Not called by current frontend load; intended API primitive |
| `POST` | `/api/movements` | Movement payload | `{ id }` | AI/API docs; not current legacy add form |
| `POST` | `/api/movements/batch` | `{ items: [movement...] }` | `{ created }` | AI/API docs |
| `PUT` | `/api/movements/:id` | Full movement payload | `{ success: true }` | API docs |
| `DELETE` | `/api/movements/:id` | none | `{ success: true }` | API docs |
| `GET` | `/api/transactions` | Optional `search`, `category`, `type` | Legacy transaction-shaped movement rows | `loadAll()` ledger |

Important mismatch: `public/app.js` still attempts `POST`, `PUT`, and `DELETE` on `/api/transactions`, but `src/server/routes/transactions.ts` only implements `GET`. Transaction write forms should be migrated to `/api/movements` before relying on the ledger UI.

### Wallets

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/wallets` | none | Wallets with derived `balance`, `earmarked`, `free`, recent `activity` | `loadAll()` |
| `POST` | `/api/wallets` | `{ name, type?, account_number?, initial_balance? }` | `{ id }` | Wallet add form |
| `PUT` | `/api/wallets/:id` | `{ name, account_number? }` | `{ success: true }` | Wallet edit form |
| `DELETE` | `/api/wallets/:id` | none | `{ success: true }` | Wallet delete form |
| `POST` | `/api/wallets/:id/income` | `{ amount, category_id?, date, description? }` | `{ id }` | Wallet income form |
| `POST` | `/api/wallets/:id/expense` | `{ amount, category_id?, date, description? }` | `{ id, warning? }` | Wallet expense form |
| `POST` | `/api/wallets/transfer` | `{ amount, date?, notes?, src_kind?, src_id?, dst_kind?, dst_id?, from_wallet_id?, to_wallet_id? }` | `{ success: true }` | Wallet transfer form |

### Categories, budgets, earmarks

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/categories` | none | Category rows | `loadAll()` |
| `POST` | `/api/categories` | `{ name, type, is_debt_service? }` | `{ id }` | Category add form |
| `PUT` | `/api/categories/:id` | `{ name, type, is_debt_service? }` | `{ success: true }` | Not currently exposed in frontend |
| `DELETE` | `/api/categories/:id` | none | `{ success, uncategorized }` | Category delete form |
| `GET` | `/api/budgets` | Optional `month=YYYY-MM` | Budgets with `actual`, `remaining`, `status` | `loadAll()` |
| `POST` | `/api/budgets` | `{ category_id, budget_amount, month? }` | `{ id }` | Budget form |
| `PUT` | `/api/budgets/:id` | `{ budget_amount }` | `{ success: true }` | Not currently exposed |
| `DELETE` | `/api/budgets/:id` | none | `{ success: true }` | Budget delete form |
| `DELETE` | `/api/earmarks/:id` | none | `{ success: true }` | Goal earmark delete action |

### Goals

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/goals` | none | Goals with `progress`, `pct`, `reached`, `earmarks[]` | `loadAll()` |
| `POST` | `/api/goals` | `{ name, target_amount, icon? }` | `{ id }` | Goal add form |
| `PUT` | `/api/goals/:id` | `{ name, target_amount, icon? }` | `{ success: true }` | Goal edit form |
| `DELETE` | `/api/goals/:id` | none | `{ success: true }` | Goal delete form |
| `POST` | `/api/goals/:id/allocate` | `{ source_type?, source_id, amount }` | `{ id }` | Goal allocation form |

### Cicilan

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/cicilan` | none | Cicilan rows enriched with `sisa`, `monthsLeft`, `pctPaid` | `loadAll()` |
| `GET` | `/api/cicilan/:id/schedule` | none | Amortization schedule rows | Not currently called by frontend |
| `POST` | `/api/cicilan` | `{ name, total_utang, monthly_payment, tenor_bulan?, bunga_persen?, start_date, due_date, notes? }` | `{ id }` | Cicilan add form |
| `PUT` | `/api/cicilan/:id` | `{ name, total_utang, monthly_payment, bunga_persen?, status? }` | `{ success: true }` | Cicilan edit form |
| `DELETE` | `/api/cicilan/:id` | none | `{ success: true }` or error if unpaid | Cicilan delete form |
| `POST` | `/api/cicilan/:id/pay` | `{ amount, src_kind?, src_id?, wallet_id?, date, description?, category_id? }` | `{ id }` | API docs; not current frontend |

### Credit cards

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/credit-cards` | none | Cards with derived `balance`, `utilization`, `color`, `available` | `loadAll()` |
| `POST` | `/api/credit-cards` | `{ name, limit_amount, statement_day, due_day, min_payment_pct?, interest_rate?, annual_fee? }` | `{ id }` | Credit card add form |
| `PUT` | `/api/credit-cards/:id` | Card settings | `{ success: true }` | Credit card edit form |
| `DELETE` | `/api/credit-cards/:id` | none | `{ success: true }` or non-zero balance error | Credit card delete form |

Important mismatch: the frontend add/edit forms include `balance`, but the `POST` route ignores opening balance and sets `balance` to `0`; the `PUT` route does not update `balance` either. Card balance changes should be represented through movements or explicit base-balance/snapshot conventions.

### Deposits

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/deposits` | none | Deposits with derived `balance`, `interestEarned`, `maturityValue`, `status` | `loadAll()` |
| `POST` | `/api/deposits` | `{ bank, amount, rate?, tenor_months, start_date, maturity_date }` | `{ id }` | Deposit add form |
| `PUT` | `/api/deposits/:id` | `{ amount, rate?, tenor_months }` | `{ success: true }` | Deposit edit form |
| `DELETE` | `/api/deposits/:id` | none | `{ success: true }` | Deposit delete form |
| `POST` | `/api/deposits/:id/withdraw` | `{ amount, wallet_id?, interest?, date?, description? }` | `{ success: true }` | API docs; not current frontend |

The schema has `withdrawal_wallet_id`, but the create route does not bind it despite docs mentioning it.

### Portfolios

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/portfolios` | none | Portfolios with `currentValue` | `loadAll()` |
| `POST` | `/api/portfolios` | `{ name, value? }` | `{ id }` | Portfolio add form |
| `PUT` | `/api/portfolios/:id` | `{ name, value }` | `{ success: true }` | Portfolio edit/value snapshot form |
| `DELETE` | `/api/portfolios/:id` | none | `{ success: true }` | Portfolio delete form |
| `POST` | `/api/portfolios/:id/trade` | `{ amount, wallet_id, direction?, date?, description? }` | `{ success: true }` | API docs; not current frontend |

Important mismatch: `GET /api/portfolios` returns `currentValue`, but `public/app.js` maps `p.value`; dashboard/assets UI may show stale/undefined portfolio values unless adjusted to `currentValue`.

### Recurring

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/recurring` | none | Template rows | `loadAll()` |
| `POST` | `/api/recurring` | Template movement and schedule fields | `{ id }` | Recurring add form |
| `PUT` | `/api/recurring/:id` | Partial template update | `{ success: true }` | Pause/resume action |
| `DELETE` | `/api/recurring/:id` | none | `{ success: true }` | Recurring delete action |
| `POST` | `/api/recurring/sweep` | none | `{ emitted }` | API/manual; dashboard also sweeps internally |

### API tokens

| Method | Route | Request | Response | Called from |
| --- | --- | --- | --- | --- |
| `GET` | `/api/tokens` | none | Token metadata, no raw token | API page |
| `POST` | `/api/tokens` | `{ label }` | `{ id, token, prefix }` | API page generate action |
| `DELETE` | `/api/tokens/:id` | none | `{ success: true }` | API page revoke action |

## 8. Major Modules

### Authentication module

Purpose: establish user identity for browser and API clients.

Important files:

- `src/server/app.ts`
- `src/server/middleware/auth.ts`
- `src/server/routes/tokens.ts`
- `src/pages/login.astro`

Interactions:

- Login writes a cookie consumed by auth middleware.
- Token routes write `api_tokens`; middleware reads and updates them.
- All resource routes depend on `c.get("userId")` set by middleware.

### Movement ledger module

Purpose: canonical record of money movement.

Important files:

- `db/migrations/0003_movements.sql`
- `src/server/routes/movements.ts`
- `src/server/formulas.ts`
- `docs/SKILL.md`

Interactions:

- Wallets, deposits, portfolios, credit cards, cicilan, budgets, dashboard, and net worth all read movements.
- Recurring templates create movements.
- Legacy transactions route reads movements and returns old transaction shape.

### Wallet/liquidity module

Purpose: liquid account management and wallet-level actions.

Important files:

- `src/server/routes/wallets.ts`
- `src/server/formulas.ts`
- `public/app.js` wallet renderers/forms

Interactions:

- Wallet balances derive from movements.
- Wallets can source earmarks.
- Wallet actions create income, expense, or transfer movements.

### Budget/category module

Purpose: classify P&L and compare monthly expenses against caps.

Important files:

- `src/server/routes/manage.ts`
- `src/server/formulas.ts`
- `public/app.js` category and budget renderers/forms

Interactions:

- Movement category IDs drive actual spending.
- Budget rows join categories and exclude debt-service categories.
- Frontend category names are used to look up IDs.

### Debt module

Purpose: installment debt and credit cards.

Important files:

- `src/server/routes/cicilan.ts`
- `src/server/routes/misc.ts` credit card section
- `src/server/formulas.ts`
- `public/app.js` cicilan and credit-card screens

Interactions:

- Cicilan payments are `wallet -> cicilan` movements.
- Credit card charges are `credit_card -> outside`; payments are `wallet -> credit_card`.
- Dashboard and net worth subtract liabilities.

### Asset module

Purpose: deposits and portfolios.

Important files:

- `src/server/routes/misc.ts` deposits and portfolios sections
- `src/server/formulas.ts`
- `db/migrations/0002_balance_history.sql`
- `public/app.js` assets screen

Interactions:

- Deposit balances derive from base amount plus movements.
- Portfolio market values derive from balance history snapshots and outflows.
- Net worth includes deposits and portfolios as assets.

### Goals and earmarks module

Purpose: virtual savings allocations.

Important files:

- `src/server/routes/goals.ts`
- `src/server/routes/manage.ts` earmarks delete route
- `src/server/formulas.ts`
- `public/app.js` goals screen

Interactions:

- Goals read earmarks for progress.
- Wallet free balances subtract wallet earmarks.
- Wallet expense route warns if spending exceeds free balance.

### Reporting/dashboard module

Purpose: summary health, P&L, and net-worth trend.

Important files:

- `src/server/routes/dashboard.ts`
- `src/server/routes/networth.ts`
- `src/server/formulas.ts`
- `public/app.js` dashboard, stats, networth, scenarios pages

Interactions:

- Dashboard performs a best-effort recurring sweep before computing current metrics.
- Net worth reconstructs 6 months of month-end values using movements and balance history.
- Frontend recalculates some dashboard totals locally from `M`, creating a risk of drift from API-returned totals.

### Recurring module

Purpose: scheduled future movement templates.

Important files:

- `src/server/routes/recurring.ts`
- `src/server/routes/dashboard.ts`
- `tests/recurring.test.ts`
- `public/app.js` recurring screen

Interactions:

- Templates store movement endpoint fields.
- Dashboard and manual sweep emit due movements.
- Date advancement is pure-tested.

### AI/API integration module

Purpose: expose a bearer-token API and documentation for automation/AI agents.

Important files:

- `docs/SKILL.md`
- `src/pages/ai.ts`
- `src/server/routes/tokens.ts`
- `src/server/middleware/auth.ts`

Interactions:

- API & AI frontend page manages tokens.
- `/ai` serves the skill markdown.
- The skill doc describes the movement model and endpoint usage.

## 9. Current Financial Model

### Wallets

Wallets are liquid assets with a stored `initial_balance`. Current wallet balance is:

`initial_balance + sum(movements where dst is wallet) - sum(movements where src is wallet)`

Wallet free balance is current balance minus wallet-source earmarks.

### Movements

Movements are the accounting core:

- Amounts are positive.
- Direction is `src -> dst`.
- Null source means income from outside.
- Null destination means expense to outside.
- Transfers and debt payments have real destinations and are not P&L expenses unless they leave to outside.

### Deposits

Deposits are assets with base `amount`, rate, tenor, dates, and status. Current deposit balance is base amount plus inbound deposit movements minus outbound deposit movements. Simple interest and maturity value are computed as display fields. Deposit creation/update appends balance history.

### Portfolios

Portfolios are investment accounts. Cash trades are movements, but market value is snapshot-based. `balance_history` stores value snapshots. Current portfolio value is latest snapshot minus outflows after that snapshot. This design separates cash contribution/withdrawal events from market gains/losses.

### Credit cards

Credit cards are liabilities. Base `balance` is an opening owed amount, though the current create/edit UI and routes do not fully align on editing that base. Charges increase liability as movements from credit card to outside; payments reduce liability as movements to the credit card.

### Liabilities

The system currently models two liability kinds:

- `credit_card`
- `cicilan`

`accountBalance()` treats those kinds inversely: source movements increase owed balance, destination movements reduce owed balance.

### Categories

Categories classify income/expense and support budgets. Categories are not a full chart of accounts; they are P&L tags on movements. Debt-service categories can be flagged to exclude them from budget listings.

### Balance history

`balance_history` is append-only and used for value snapshots of portfolio/deposit/credit-card entities. The strongest current usage is portfolio valuation and historical net worth. Wallets and cicilan do not use balance history because their values are reconstructed from dated movements and base balances.

### Net worth

Current dashboard net worth is:

`wallet liquid assets + deposits + portfolios - credit card liabilities - cicilan remaining`

Historical net worth reconstructs six month-end snapshots:

- Wallets: base plus movements up to month end.
- Deposits: base plus movements up to month end after start date.
- Credit cards: base plus charges minus payments up to month end.
- Cicilan: original debt minus payments up to month end after start date.
- Portfolios: latest balance history snapshot as of month end.

### Reporting

Dashboard reports current-period income, expense, sisa, liquid totals, free/earmarked balances, asset/liability totals, net worth, savings rate, and DTI. Budgets report monthly actuals and status. Net worth reports a 6-month trend. What-if scenarios are frontend-calculated from current income/expense/debt inputs.

### SMS transaction flow

No implemented SMS ingestion flow was found in the current source tree. The closest automation-oriented flow is the AI/API bearer-token interface and the movement batch endpoint. Any future SMS parser should probably produce validated `movements` payloads rather than writing directly to legacy transaction concepts.

## 10. Coding Conventions and Patterns

### Naming conventions

- Database table and column names use `snake_case`.
- TypeScript variables and functions use `camelCase`.
- Route files are grouped by resource (`wallets.ts`, `movements.ts`, `recurring.ts`, etc.).
- Astro components use `PascalCase.astro`.
- Client renderers use `renderX`, chart initializers use `initX`, modal openers use `showX`, mutations use `saveX` / `doX` / `deleteX`.

### Folder conventions

- API/business logic lives under `src/server`.
- Hono route modules live under `src/server/routes`.
- Shared pure financial logic belongs in `src/server/formulas.ts` and is unit-tested.
- Astro shell/navigation lives in `src/pages`, `src/layouts`, and `src/components`.
- Current rich UI logic is centralized in `public/app.js`, not in Astro islands or componentized frontend modules.
- SQL migrations live in `db/migrations` with ordered numeric prefixes.

### Migration conventions

- Migrations are raw SQL files named `000N_description.sql`.
- Schema changes are append-only migration files; existing migrations should not be edited after deployment.
- Migration `0004` demonstrates cleanup after a replacement architecture: legacy ledgers were dropped after movements backfill verification.

### API conventions

- All resource routes are scoped by `user_id` from auth middleware.
- Create routes usually return `{ id }` with status `201`.
- Update/delete routes usually return `{ success: true }`.
- Errors are JSON `{ error: string }` with 400/401/404 as appropriate.
- D1 access uses prepared statements with `.bind()`.
- Routes often return derived fields rather than raw DB rows only.
- There is no centralized request validation layer; validation is route-local and minimal.

### UI conventions

- UI pages are string-rendered HTML functions in `public/app.js`.
- Styling uses CSS variables such as `--c-primary`, `--c-sub`, `--c-border`, `--c-success`, `--c-danger`, and Tailwind utility classes.
- Forms are modal-based and invoke global functions via inline `onclick` attributes.
- Most mutations call `reload()` to refresh all state after success.
- Monetary display is Indonesian Rupiah integer formatting (`Rp` plus `id-ID` locale separators).

### Testing conventions

- Pure formula helpers have direct unit tests.
- Hono routes are tested by mounting route modules into test harnesses with mocked D1.
- Auth is tested at the full app level with a mocked D1 prepare chain.
- Tests focus on core domain calculations and critical route behavior, not UI rendering.

## 11. Extension Points for a Future Wealth Module

### Navigation

Add a logical page ID to:

- Desktop sidebar section(s) in `src/components/Sidebar.astro`.
- Mobile bottom nav or More overlay in `src/components/MobileBottomNav.astro`.
- `renderPage()` switch in `public/app.js`.

A Wealth module likely belongs under **ANALYZE** if it is reporting-focused, or **MANAGE** if it owns new account objects.

### Frontend state and loading

Add new state fields to `M`, fetch the new endpoint in `loadAll()`, reshape response data there, and add render/form functions in `public/app.js`. If the module grows large, consider splitting `public/app.js` first to avoid expanding an already monolithic file.

### Database

Options depend on what “Wealth” means:

- If wealth is **reporting over existing assets/liabilities**, reuse `movements`, `balance_history`, and existing account tables.
- If wealth needs **new asset classes** (brokerage positions, real estate, retirement accounts, metals, private equity), decide whether they are new `entity_kind` values in `balance_history`, new movement endpoint kinds, or normalized new tables.
- Any new table should include `user_id`, integer IDR amounts, and date fields consistent with existing conventions.
- Any new movement endpoint kind must be added consistently across validation, calculations, dashboard, net-worth reconstruction, docs, and frontend forms.

### API

Add a new route module under `src/server/routes/` and mount it in `src/server/app.ts`. Follow current response conventions (`{ id }`, `{ success: true }`, derived fields where useful). If new financial math is introduced, put pure helpers in `src/server/formulas.ts` or a similarly tested helper file.

### Reports and dashboard

Integrate Wealth totals into:

- `/api/dashboard` if they affect current assets, liabilities, or net worth.
- `/api/net-worth` if they need historical month-end reconstruction.
- `renderDashboard()` if summary cards should show the new values.
- `renderNetWorth()` / `initNetWorthChart()` if wealth is charted over time.
- `renderStats()` if wealth changes reporting categories or breakdowns.

### Charts

Use the existing Chart.js pattern: destroy chart instances on navigation, then initialize page-specific charts after rendering. Store chart instances in the global `charts` map.

### Settings/API docs

If the Wealth module has API endpoints or agent workflows, update:

- `docs/SKILL.md`
- `/ai` will automatically serve the updated skill doc.
- API & AI page endpoint cards in `public/app.js` if visible endpoint docs are maintained there.

### Categories and movements

If wealth events should affect P&L, represent them as `movements` with null src/dst where appropriate. If they are transfers or valuation changes, avoid P&L category misuse; use real endpoints or balance snapshots.

## 12. Technical Debt and Risks

1. **Frontend transaction writes target read-only compatibility route.** The server only implements `GET /api/transactions`, but `public/app.js` still posts/puts/deletes `/api/transactions`.
2. **Portfolio value mapping mismatch.** The portfolios API returns `currentValue`, but the frontend maps `p.value`, risking incorrect asset/dashboard displays.
3. **Credit-card opening balance mismatch.** Frontend forms include `balance`, but create/update routes ignore it or do not update it.
4. **Deposit `withdrawal_wallet_id` mismatch.** Schema and docs mention it, but deposit creation does not persist it.
5. **Dashboard totals are partly recalculated in the frontend.** The API returns authoritative totals, but `renderDashboard()` recomputes many values from frontend-shaped state, which can drift from backend formulas.
6. **Auth password hashing is weak.** Passwords use unsalted SHA-256, which is explicitly documented as a personal-instance limitation.
7. **Session cookie stores plain user ID.** There is no signed session token; the middleware trusts a parseable ID if a corresponding user exists, with a dev fallback for ID 1.
8. **Validation is minimal and inconsistent.** Many routes do not validate enum values, ownership of referenced IDs, or full required field sets.
9. **No foreign keys for movement endpoints.** `src_kind/src_id` and `dst_kind/dst_id` are polymorphic and not enforceable by SQLite FKs.
10. **Large monolithic frontend file.** `public/app.js` contains state, routing, rendering, forms, and mutations in one file, which increases merge conflict risk for future modules.
11. **Name-to-ID frontend maps can collide.** Wallet/category/portfolio lookups use names as map keys, so duplicate names can submit the wrong ID.
12. **Balance history semantics are uneven.** Portfolios strongly use it; deposits/cards append snapshots but current calculations are mostly movement-derived.
13. **Recurring sweep is best-effort and not fully idempotent in manual route.** Dashboard sweep checks for existing movement by recurring/date; manual sweep inserts without the same `NOT EXISTS` guard.

## 13. Recommendations Before Implementing a Wealth Module

1. **Fix existing API/UI mismatches first.** Specifically migrate transaction write forms to `/api/movements`, map portfolio `currentValue`, clarify credit-card balance handling, and persist deposit `withdrawal_wallet_id` if it remains in the model.
2. **Define whether Wealth is a new account kind or a reporting layer.** If it is reporting-only, avoid new schema and extend dashboard/net-worth calculations. If it introduces new asset classes, explicitly design their movement endpoint semantics and balance-history semantics.
3. **Create a small architecture decision record for new financial entities.** Include: whether balances are movement-derived or snapshot-derived, how they affect P&L, how they affect net worth, and how they appear in AI docs.
4. **Add tests before extending formulas.** Any new wealth calculations should be pure-tested like `accountBalance()`, `portfolioValue()`, `pnl()`, and recurring date logic.
5. **Prefer backend-authoritative reporting.** Let API routes compute Wealth totals and have the frontend display returned values instead of duplicating formulas in `public/app.js`.
6. **Consider modularizing the frontend before a large module.** Even a lightweight split by page/module would reduce risk as Wealth screens are added.
7. **Keep using migrations only for schema changes.** Do not edit old migrations; create `0005_...sql` when actual implementation begins.
8. **Update `docs/SKILL.md` together with new endpoints.** The AI agent interface is part of the product, not an afterthought.
9. **Preserve the movement-ledger architecture.** Future Wealth work should fit the `src -> dst`, positive amount, derived balance model unless there is a clearly documented reason not to.
