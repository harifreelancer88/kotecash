# kotecash — Test Cases (v3.0)

> Covers all CRUD flows + edge cases discovered during mockup design
> Mockup: `docs/initial/sample_pages/index.html` — all flows validated against inline mock data

---

## 1. Dashboard (Home)

### Display
- [ ] TC-DASH-01: Income/Expense/Sisa 3-card row renders with correct values and color coding
- [ ] TC-DASH-02: Liquid card shows total, wallet count, Free + Earmarked breakdown
- [ ] TC-DASH-03: CC Debt shows total across all credit cards
- [ ] TC-DASH-04: Assets shows deposits + portfolios total
- [ ] TC-DASH-05: Net Worth = Liquid + Assets − CC − Cicilan remaining
- [ ] TC-DASH-06: Monthly Flow badge color correct: ≥30% Outstanding(green), ≥20% Excellent(blue), ≥10% Good(amber), <10% Needs Improvement(red)
- [ ] TC-DASH-07: DTI tier correct: <30% Healthy(green), <50% High(amber), ≥50% Critical(red)
- [ ] TC-DASH-08: Goals snapshot shows all 3 goals with correct progress %, progress bars, amounts
- [ ] TC-DASH-09: Budgets shows first 4 categories with progress bars and badge
- [ ] TC-DASH-10: Upcoming Payments shows cicilan + CC due dates
- [ ] TC-DASH-11: All cards have white background (`.card`), no `.health-tag` anywhere

### Filter
- [ ] TC-DASH-12: Month dropdown has 4 options: This Month, Last Month, Next Month, All Time
- [ ] TC-DASH-13: Year dropdown has 2025, 2026, 2027

### Edge Cases
- [ ] TC-DASH-14: Negative net balance shows red, not green
- [ ] TC-DASH-15: Zero values render as "Rp0", not blank
- [ ] TC-DASH-16: Free balance negative when wallet earmarks > wallet balance → shows red
- [ ] TC-DASH-17: DTI = 0 when no income → shows 0.0%, not NaN

---

## 2. Ledger

### CRUD
- [ ] TC-LED-01: All transactions render in compact single-line rows
- [ ] TC-LED-02: Income transaction shows green "+Rp..." 
- [ ] TC-LED-03: Expense transaction shows red "−Rp..."
- [ ] TC-LED-04: Desktop: edit (pencil) + delete (trash-2) buttons visible on each row
- [ ] TC-LED-05: Mobile: edit/delete hidden, kebab (⋯) button visible
- [ ] TC-LED-06: Click kebab → dropdown appears with Edit + Delete options
- [ ] TC-LED-07: Click outside dropdown → dropdown closes
- [ ] TC-LED-08: Click another row's kebab → first dropdown closes, new one opens
- [ ] TC-LED-09: Search input filters transactions by description
- [ ] TC-LED-10: Category filter shows correct categories
- [ ] TC-LED-11: Type filter (All/Income/Expense) filters correctly
- [ ] TC-LED-12: "Add" button opens Add Transaction modal
- [ ] TC-LED-13: Add Transaction modal: amount + type + date + category + method + notes → Save creates new row

### Edge Cases
- [ ] TC-LED-14: Empty transaction list shows "No transactions" (or empty state)
- [ ] TC-LED-15: Very long description truncates with "..."
- [ ] TC-LED-16: Special characters in description handled (quotes, <, >)
- [ ] TC-LED-17: Add Transaction with empty amount → no-op (no row created)
- [ ] TC-LED-18: Multiple kebabs open at once → only latest stays open

---

## 3. Wallets

### Display
- [ ] TC-WALL-01: 4 wallet cards render: BCA, OVO, GoPay, Cash
- [ ] TC-WALL-02: Each shows correct icon by type (building-2, smartphone, banknote)
- [ ] TC-WALL-03: Balance computed from walletTxns, not static
- [ ] TC-WALL-04: Balance formula: income + transfers_in − expenses − transfers_out

### CRUD — Income
- [ ] TC-WALL-05: Click "Income" button → modal with Amount, Category, Date, Notes
- [ ] TC-WALL-06: Add Income: fill form → balance increases, walletTxn added, page refreshes
- [ ] TC-WALL-07: Categories: Gaji M2, Freelance, Lain-lain Income
- [ ] TC-WALL-08: Add Income with 0 amount → no-op

### CRUD — Expense
- [ ] TC-WALL-09: Click "Expense" button → modal with Amount, Category, Date, Notes
- [ ] TC-WALL-10: Add Expense: fill form → balance decreases, walletTxn added
- [ ] TC-WALL-11: Categories match budget categories
- [ ] TC-WALL-12: Expense with 0 amount → no-op

### Earmark Warning (Critical)
- [ ] TC-WALL-13: Spend ≤ walletFree → no warning, transaction recorded
- [ ] TC-WALL-14: Spend > walletFree → alert shows: "RpX exceeds free balance (RpY). RpZ will come from earmarked goals: [goal names]"
- [ ] TC-WALL-15: Alert correctly identifies which goals are impacted
- [ ] TC-WALL-16: Warning still records the transaction (does not block)

### CRUD — Transfer
- [ ] TC-WALL-17: Click "Transfer" → modal with From, To, Amount, Notes
- [ ] TC-WALL-18: Transfer BCA → OVO: creates 2 walletTxns (transfer_out + transfer_in), updates both balances
- [ ] TC-WALL-19: Transfer from = to → no-op (same wallet)
- [ ] TC-WALL-20: Transfer 0 amount → no-op

### CRUD — Edit Wallet
- [ ] TC-WALL-21: Click "Edit" → modal with Name, Balance, Account Number pre-filled
- [ ] TC-WALL-22: Save → name/balance/number updated, page refreshes

### Reconciliation (Expand)
- [ ] TC-WALL-23: Click wallet card → expands to show reconciliation breakdown
- [ ] TC-WALL-24: Reconciliation shows: Income, Transfers In, Expenses, Transfers Out, Net Balance
- [ ] TC-WALL-25: Net Balance matches wallet balance exactly
- [ ] TC-WALL-26: Activity log shows latest 8 transactions with correct icons and colors
- [ ] TC-WALL-27: Click again → collapses

### Edge Cases
- [ ] TC-WALL-28: Wallet with 0 transactions shows "No transactions yet"
- [ ] TC-WALL-29: Negative wallet balance shows red, "deficit" label
- [ ] TC-WALL-30: Transfer where source has insufficient funds → balance goes negative (no block)
- [ ] TC-WALL-31: Multiple rapid transfers → all double-entries recorded correctly

---

## 4. Goals

### Display
- [ ] TC-GOAL-01: Total Earmarked card shows sum of all earmarks
- [ ] TC-GOAL-02: Goal cards: Sekolah Anak (50jt target), Umroh (80jt), Dana Darurat (15jt)
- [ ] TC-GOAL-03: Each shows icon, name, target, progress amount, %, progress bar
- [ ] TC-GOAL-04: Progress bar: c-focus fill, turns c-success at 100%
- [ ] TC-GOAL-05: Earmarked From: list of sources with amounts

### CRUD — New Goal
- [ ] TC-GOAL-06: "New Goal" button → modal with Name, Target, Icon dropdown
- [ ] TC-GOAL-07: Icon picker: graduation-cap, map, shield, home, heart, briefcase, car, plane
- [ ] TC-GOAL-08: Create: goal added to M.goals, navigates to goals page
- [ ] TC-GOAL-09: Create with empty name → no-op
- [ ] TC-GOAL-10: Create with 0 target → no-op

### CRUD — Allocate Earmark
- [ ] TC-GOAL-11: "Allocate" button → modal with Source dropdown + Amount
- [ ] TC-GOAL-12: Source dropdown contains: wallets + deposits + portfolios
- [ ] TC-GOAL-13: Allocate: earmark added to M.earmarks, goal progress updates, page refreshes
- [ ] TC-GOAL-14: Goal at 100%+ shows "Goal reached!" instead of remaining
- [ ] TC-GOAL-15: Allocate 0 amount → no-op

### Edge Cases
- [ ] TC-GOAL-16: Goal with no allocations shows "No allocations yet"
- [ ] TC-GOAL-17: Multiple earmarks from same source to same goal → both shown
- [ ] TC-GOAL-18: Earmark from non-existent source → possible (just tracks name)
- [ ] TC-GOAL-19: Goal progress exceeds target → shows >100%, bar capped at 100%

---

## 5. Credit Card

### Display
- [ ] TC-CC-01: Card shows name, balance, limit, statement day, due day
- [ ] TC-CC-02: Utilization % color: ≤30% green, 31-50% amber, >50% red
- [ ] TC-CC-03: Min payment, interest rate, annual fee, available credit
- [ ] TC-CC-04: Summary: Total Balance, Total Limit, Utilization %

### CRUD
- [ ] TC-CC-05: Edit button → modal with Balance, Limit, Interest Rate, Statement Day, Due Day
- [ ] TC-CC-06: Save → values updated, page refreshes

### Edge Cases
- [ ] TC-CC-07: Zero balance → Utilization = 0%
- [ ] TC-CC-08: Balance > Limit → Utilization >100% (possible with over-limit)

---

## 6. Cicilan

### Display
- [ ] TC-CIC-01: Active cicilan card: name, remaining principal, months remaining
- [ ] TC-CIC-02: Progress bar: % paid with c-focus fill
- [ ] TC-CIC-03: Monthly payment, interest rate, due date, total loan
- [ ] TC-CIC-04: Click card → expands amortization table
- [ ] TC-CIC-05: Amortization: Month, Payment, Principal, Interest, Remaining columns
- [ ] TC-CIC-06: Last row has remaining = 0

### CRUD
- [ ] TC-CIC-07: "Add Cicilan" → modal with name, total, monthly, tenor, interest, start, due
- [ ] TC-CIC-08: Edit button → modal with remaining, monthly, interest
- [ ] TC-CIC-09: Save → values updated, page refreshes

### Edge Cases
- [ ] TC-CIC-10: Paid-off cicilan (sisa=0) → shows 100% progress
- [ ] TC-CIC-11: Very long amortization (60+ months) → scrollable table

---

## 7. Assets

### Display
- [ ] TC-ASS-01: Deposits: bank, amount, interest rate, tenor, maturity, status
- [ ] TC-ASS-02: Deposits show interest earned, maturity value
- [ ] TC-ASS-03: Portfolios: name, value, edit button
- [ ] TC-ASS-04: Total Deposits + Total Portfolio sums

### CRUD
- [ ] TC-ASS-05: "Add Deposit" → modal with bank, amount, rate, tenor, start date
- [ ] TC-ASS-06: "Add Portfolio" → modal with name, value
- [ ] TC-ASS-07: Edit Portfolio → modal with name, value

### Edge Cases
- [ ] TC-ASS-08: Matured deposit → status shows "Matured" not "Active"
- [ ] TC-ASS-09: Empty deposits → section still renders with 0 total

---

## 8. Categories & Budgets

### Categories
- [ ] TC-CAT-01: Expense Categories + Income Categories side by side
- [ ] TC-CAT-02: Each category has edit (pencil) button
- [ ] TC-CAT-03: "Add Category" → modal with name + type (Expense/Income)

### Budgets
- [ ] TC-BUD-01: Budget rows: category, budget, actual, remaining, status badge
- [ ] TC-BUD-02: UNDER (<90%): green check-circle-2
- [ ] TC-BUD-03: ON TRACK (90-100%): blue check-circle
- [ ] TC-BUD-04: OVER (>100%): red alert-triangle
- [ ] TC-BUD-05: "Set Budget" → modal with category, amount, month
- [ ] TC-BUD-06: Month label shows current month (e.g., "June 2026")

### Edge Cases
- [ ] TC-BUD-07: Budget removed from list (BRI, CC TOKPED, CC BCA excluded)
- [ ] TC-BUD-08: Budget with 0 actual → shows Rp0 / RpX, UNDER badge
- [ ] TC-BUD-09: Actual exactly = budget → ON TRACK badge

---

## 9. Net Worth

### Display
- [ ] TC-NW-01: Assets / Liabilities / Net Worth 3-card summary
- [ ] TC-NW-02: Net Worth shows delta from previous month
- [ ] TC-NW-03: Trend line chart: Assets(green), Liabilities(red), Net Worth(blue)
- [ ] TC-NW-04: Y-axis formatted in millions (e.g., "10M")

### Edge Cases
- [ ] TC-NW-05: Negative net worth → red with negative delta
- [ ] TC-NW-06: Single data point → chart renders with one point

---

## 10. What-If Simulator

### Display
- [ ] TC-WI-01: Income slider (-50% to +100%) + Expense slider (-50% to +100%)
- [ ] TC-WI-02: 4 scenario cards update in real-time on slider change
- [ ] TC-WI-03: Comparison bar chart: Current vs Scenario savings rate
- [ ] TC-WI-04: Detailed breakdown table: all metrics with Δ column

### Edge Cases
- [ ] TC-WI-05: Both sliders at 0 → scenario matches current
- [ ] TC-WI-06: Income -50%, expense +100% → worst case renders correctly
- [ ] TC-WI-07: DTI > 100% → handled gracefully (not NaN)

---

## 11. API & AI

### Display
- [ ] TC-API-01: Active Tokens table: label, prefix, created, last used, revoke button
- [ ] TC-API-02: Quick Start code block with curl example
- [ ] TC-API-03: Endpoints table: method, path, description
- [ ] TC-API-04: All 9 endpoints listed

---

## 12. Cross-Cutting

### UI
- [ ] TC-UI-01: Zero emoji anywhere in UI (grep for unicode emoji range)
- [ ] TC-UI-02: All icons from Lucide (data-lucide attributes), no inline emoji
- [ ] TC-UI-03: Sidebar has 4 sections with uppercase labels
- [ ] TC-UI-04: Sidebar collapses to 56px, toggles icon swaps
- [ ] TC-UI-05: Brand text shows "kotecash" (no 📒 emoji)
- [ ] TC-UI-06: All currency in Rp with `id-ID` formatting (Rp11.774.644)
- [ ] TC-UI-07: `node --check` passes on extracted inline JS

### Mobile
- [ ] TC-MOB-01: ≤768px: sidebar hidden, bottom nav visible
- [ ] TC-MOB-02: Bottom nav: Home, Ledger, Stats, Debt, More (5 items)
- [ ] TC-MOB-03: "More" opens 3-column grid popup
- [ ] TC-MOB-04: Content padding-bottom: 80px (clears bottom nav)
- [ ] TC-MOB-05: Card rows wrap on mobile

### Modal System
- [ ] TC-MOD-01: `openModal(title, body)` creates modal with backdrop
- [ ] TC-MOD-02: Click backdrop → closes modal
- [ ] TC-MOD-03: Press Escape → closes modal
- [ ] TC-MOD-04: Click × button → closes modal
- [ ] TC-MOD-05: Mobile: bottom sheet style (border-radius: 16px 16px 0 0)
- [ ] TC-MOD-06: Desktop: centered modal (border-radius: 12px)
- [ ] TC-MOD-07: Multiple modals → only one open at a time

### Navigation
- [ ] TC-NAV-01: Sidebar links navigate to correct pages
- [ ] TC-NAV-02: Active nav item highlighted (c-primary text + bg)
- [ ] TC-NAV-03: Page switch destroys old Chart.js instances (no memory leak)
- [ ] TC-NAV-04: Browser back/forward works (URL `?page=` param supported)

---

## 13. Integration / Data Flow

### Wallet → Goals
- [ ] TC-FLOW-01: Allocate BCA 3jt → Sekolah Anak → goal progress increases, Free decreases
- [ ] TC-FLOW-02: Spend from BCA > Free → alert names impacted goals
- [ ] TC-FLOW-03: Transfer BCA → OVO affects wallet balances only, not goals

### Wallet → Dashboard
- [ ] TC-FLOW-04: Adding wallet income/expense → Dashboard Liquid/Free updates
- [ ] TC-FLOW-05: Adding goal earmark → Dashboard Earmarked total updates
- [ ] TC-FLOW-06: Adding CC balance → Dashboard CC Debt updates

### Consistency
- [ ] TC-CONS-01: walletBalance(name) = sum of walletTxns for that wallet
- [ ] TC-CONS-02: walletFree(name) = walletBalance − walletEarmarked
- [ ] TC-CONS-03: goalProgress(name) = sum of earmarks for that goal
- [ ] TC-CONS-04: Net Worth = Liquid + Assets − CC − Cicilan Sisa
- [ ] TC-CONS-05: Sisa = Income − Expense (not "savings")

---

**Total: 130 test cases across 14 categories**

## 14. Missing CRUD (Not in Mockup — Must Build) ⚠️

These operations are documented in spec §3 but have no UI in the mockup HTML. Production must implement all.

### Wallets
- [ ] TC-MISS-01: Create Wallet modal: name + type (bank/e-wallet/cash) + account number
- [ ] TC-MISS-02: Create Wallet with empty name → no-op
- [ ] TC-MISS-03: Delete Wallet: confirmation modal → cascades walletTxns, transfers, earmarks
- [ ] TC-MISS-04: Delete Wallet with active earmarks → warning lists impacted goals
- [ ] TC-MISS-05: Delete Wallet with active transfers → warning lists transfer count

### Goals
- [ ] TC-MISS-06: Edit Goal modal: pre-filled name, target, icon dropdown → update
- [ ] TC-MISS-07: Edit Goal to lower target than current progress → warn but allow
- [ ] TC-MISS-08: Delete Goal: confirmation → cascades all earmarks
- [ ] TC-MISS-09: Delete Goal with 0 progress → allowed immediately
- [ ] TC-MISS-10: Delete Goal with progress > 0 → warn "RpX in earmarks will be removed"

### Earmarks
- [ ] TC-MISS-11: Delete Earmark: × button per source row → removes allocation
- [ ] TC-MISS-12: Delete Earmark: goal progress decreases, wallet Free increases

### Categories
- [ ] TC-MISS-13: Delete Category: warn if linked transactions exist → "X transactions will lose category"
- [ ] TC-MISS-14: Delete Category: cascade sets category to NULL on linked transactions

### Budgets
- [ ] TC-MISS-15: Delete Budget: removes budget line for that category+month

### Credit Cards
- [ ] TC-MISS-16: Add Credit Card modal: name, limit, statement day, due day, interest rate
- [ ] TC-MISS-17: Delete Credit Card: only if balance == 0 → error message otherwise

### Cicilan
- [ ] TC-MISS-18: Delete Cicilan: only if sisa == 0 → "Cannot delete active cicilan" otherwise

### Deposits
- [ ] TC-MISS-19: Edit Deposit modal: amount, rate, tenor → update maturity date
- [ ] TC-MISS-20: Delete Deposit: confirmation → removes from assets

### Portfolios
- [ ] TC-MISS-21: Delete Portfolio: confirmation → removes from assets
- [ ] TC-MISS-22: Delete Portfolio with earmarks → warning: "X earmarks reference this portfolio"

### Batch / Consistency
- [ ] TC-MISS-23: Transfer creates exactly 2 walletTxns (atomic — never only 1)
- [ ] TC-MISS-24: walletBalance recomputed on every read — never returns stale value
- [ ] TC-MISS-25: All derived fields (balance, free, progress, net worth) are computed, not stored in DB columns
- [ ] TC-MISS-26: Delete cascades are idempotent — re-running same delete after cascade produces no error
