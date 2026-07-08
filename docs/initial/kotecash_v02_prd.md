# Product Requirements Document: kotecash v0.2

> Revision from v0.1 — adds Cicilan, Financial Health, Net Worth, What-If, CSV, Share modules.
> Source spec: `kotecash_v02_spec.md`

## 1. Personas

| Persona | Role | Goals | Frustrations |
|---|---|---|---|
| **User** (Head of Household) | Primary user managing personal household finances | Track daily income/expenses, manage cicilan/debt, hit savings targets, understand spending patterns, automate data entry via AI agents, share view with spouse | Manual bookkeeping tedious, hard to see where money goes, budgets get forgotten, debt installments hard to track, no clear health picture |
| **Spouse** (Read-only viewer) | Views dashboard to stay informed | See monthly spending summary, know if budgets are on track, check upcoming cicilan | Can't see anything without asking partner, no visibility into household health |

## 2. User Stories

### Auth Module (unchanged)
- As a **User**, I want to log in with my email and password, so that my financial data stays private.
- As a **User**, I want my session to persist for 24 hours, so that I don't need to log in every time.

### API Token Module (unchanged)
- As a **User**, I want to generate an API token with a label (e.g., "hermes-agent"), so that my AI agent can programmatically log transactions.
- As a **User**, I want to see a list of all active tokens with their label and prefix, so that I know which agents have access.
- As a **User**, I want to revoke any token at any time, so that I can cut off access immediately if compromised.
- As a **User**, I want the full token shown only once at creation, so that nobody can read it again from the UI.

### Transaction Module (enhanced)
- As a **User**, I want to add a transaction with date, amount (IDR), category, type, payment method, and optional notes, so that I can record my daily spending with full context.
- As a **User**, I want to select payment method from a dropdown (Cash, Transfer, OVO, GoPay, CC BCA, CC Tokped, etc.), so that I can track which payment channel I use most.
- As a **User**, I want to link a transaction to a cicilan, so that my installment payments are automatically tracked against the remaining principal.
- As a **User**, I want to edit or delete a transaction, so that I can correct mistakes.

### Ledger View Module (enhanced)
- As a **User**, I want to view all transactions sorted by date descending with a running balance, so that I can review my financial activity at a glance.
- As a **User**, I want to filter transactions by date range, category, type, AND payment method, so that I can find specific entries quickly.
- As a **User**, I want to search transactions by notes text, so that I can find entries by description.

### Stat View Module (enhanced)
- As a **User**, I want to see a bar chart of monthly income vs expense, so that I can visually compare my earnings and spending.
- As a **User**, I want to see a pie chart of spending by category, so that I know where my money goes.
- As a **User**, I want to see a spending trend line over time, so that I can spot patterns.
- As a **User**, I want to see a **budget variance chart** showing over/under per category, so that I know exactly which categories blew the budget.
- As a **User**, I want to see a **net worth line chart** showing assets minus liabilities over time, so that I can track wealth growth.

### Category Module (enhanced)
- As a **User**, I want predefined categories that match Indonesian household needs (BRI cicilan, CC Tokped, CC BCA, PAK AYAN, BERAS, CANANG, Listrik, BPJS, etc.), so that I can start recording right away.
- As a **User**, I want to create custom categories, so that I can tailor tracking to my household needs.

### Budget Module (enhanced)
- As a **User**, I want to set a monthly spending limit per expense category, so that I can control my spending.
- As a **User**, I want to see budget vs actual with auto-labels (🛑OVER / 💚UNDER / ✅ON TRACK) and variance percentage, so that I immediately know the situation without doing math.
- As a **User**, I want budget progress bars on the dashboard that turn red when overspent, so that I notice problems immediately.

### Dashboard Module (major enhancement)
- As a **User**, I want to see this month's total income, total expense, and net balance prominently.
- As a **User**, I want to see my **Savings Rate** with a tier label (Outstanding/Excellent/Good/Needs Improvement), so that I know my financial health at a glance.
- As a **User**, I want to see my **Debt-to-Income ratio** (total cicilan monthly / income) with a health indicator, so that I know if I'm over-leveraged.
- As a **User**, I want to see a **50/30/20 rule check** (Needs/ Wants/ Savings breakdown), so that I know if my allocation is healthy.
- As a **User**, I want to see **upcoming cicilan due this month**, so that I don't miss payments.
- As a **User**, I want a quick-add button on the dashboard, so that I can log a transaction without navigating elsewhere.

### Cicilan Module (NEW)
- As a **User**, I want to add a cicilan with: name, total amount, remaining principal, monthly payment, tenor, interest rate, start date, due date, so that I can track all my debt.
- As a **User**, I want to see a list of all active cicilan with remaining principal and months left, so that I know my debt status.
- As a **User**, I want to mark a cicilan as "paid off" and see it move to history, so that my active list stays clean.
- As a **User**, I want the remaining principal to auto-decrease when I log a transaction linked to that cicilan, so that I don't need to manually update it.

### Financial Health Module (NEW)
- As a **User**, I want an overall health score on my dashboard (color-coded: green/yellow/red), so that I can gauge my financial situation instantly.
- As a **User**, I want to see my Savings Rate benchmarked against tiers (<10% / 10-20% / 20-30% / >30%), so that I know where I stand.
- As a **User**, I want to see my DTI ratio with health rating (Healthy <30% / High 30-50% / Critical >50%), so that I can assess my debt burden.
- As a **User**, I want a 50/30/20 rule breakdown showing Needs/Wants/Savings as % of income, so that I can rebalance if needed.

### Net Worth Module (NEW)
- As a **User**, I want to record my monthly net worth (assets minus liabilities), so that I can track wealth over time.
- As a **User**, I want to see the month-over-month change (Δ), so that I know if I'm gaining or losing.
- As a **User**, I want a line chart showing net worth over the past 12 months, so that I can see the trend.

### What-If Simulator (NEW)
- As a **User**, I want to input "income +10%" and see the new savings rate, DTI, and 50/30/20 breakdown, so that I can plan for salary increases.
- As a **User**, I want to input "expense -20% in food" and see the impact on my savings rate, so that I can set realistic goals.
- As a **User**, I want to see a side-by-side comparison of current vs scenario, so that I can evaluate different paths.

### CSV Import / Export (NEW)
- As a **User**, I want to upload a CSV from my bank (BCA, Mandiri, etc.) and have transactions auto-parsed with date, description, and amount, so that I don't need to type everything.
- As a **User**, I want to map CSV columns to transaction fields during import, so that any bank format works.
- As a **User**, I want to export my full transaction ledger as CSV, so that I can use it in other tools or share with an accountant.

### Share Link (NEW) (unchanged)
- As a **User**, I want to generate a read-only share link...
- As a **User**, I want to revoke the share link...

### AI Assistant (NEW)
- As a **User**, I want my AI agent (Hermes) to fetch the current month's financial summary via API, so that I can ask "how's my budget this month?" and get an instant answer.
- As a **User**, I want my AI agent to log a transaction on my behalf via API, so that I can dictate "catat pengeluaran GoFood 45rb" and have it recorded instantly.
- As a **User**, I want my AI agent to check budget status before I spend, so that I can ask "still have budget for eating out?" and get a real answer.
- As a **User**, I want my AI agent to give me financial health feedback, so that I can ask "how's my savings rate?" and get a benchmarked response.
- As a **User**, I want a published SKILL.md with full API docs, so that any AI agent can integrate without guesswork. **(Note: SKILL.md will be generated by the coding agent during implementation — not included in these spec docs to avoid conflicts.)**

## 3. Acceptance Criteria

### Cicilan
```
Given I am on the Cicilan page
When I add "BRI" with total 50,000,000, remaining 32,000,000, monthly 1,800,000
Then it appears in active cicilan list with "18 months remaining"

Given I log a transaction of 1,800,000 linked to "BRI"
When the transaction is saved
Then the BRI remaining principal decreases to 30,200,000

Given a cicilan with remaining 0
When I mark it as "paid off"
Then it moves to history and no longer appears in active list
```

### Financial Health
```
Given May transactions: income 11,774,644, expense 8,150,000
When dashboard loads
Then Savings Rate shows "30.8% — Outstanding" (green)
And DTI shows "26.3% — Healthy" (green)
And 50/30/20 shows "Needs: 69% 🔴 Over" with "Savings: 30.8% ✅ Met"
```

### What-If
```
Given current income 11,774,644, expense 8,150,000
When I simulate "income +10%"
Then it shows: new income 12,952,108, new savings rate 37.1%
And comparison table shows current 30.8% → new 37.1% (+6.3%)
```

### CSV Import
```
Given a BCA CSV export with columns: Tanggal, Keterangan, Debit, Kredit
When I upload and map Keterangan→description, Debit→expense, Kredit→income
Then transactions are created with correct amounts and "Uncategorized" label
And I can review and categorize them before final import
```

### Share Link
```
Given I generate a share link
When my spouse opens the link
Then they see dashboard and stats in read-only mode
And there is no edit button, no add transaction, no API token tab
And a "Shared View" watermark is visible
```

### AI Assistant
```
Given I have an active API token "kote_***" 
When my AI agent sends `GET /api/dashboard` with `Authorization: Bearer kote_***`
Then it receives JSON with: total_income, total_expense, net_balance,
     savings_rate, dti_ratio, health_score, top_categories, budget_progress

Given an active token
When AI agent sends `POST /api/transactions` with {date, amount, category, type, payment_method}
Then transaction is created
And running balances update
And cicilan remaining decreases if linked

Given a revoked token
When AI agent sends any API request
Then it receives 401 Unauthorized with {"error": "Token revoked"}

Given the /ai/ route
When an AI agent loads SKILL.md
Then it finds complete endpoint documentation, curl examples,
     auth instructions, and all available operations
```

### Dashboard (enhanced)
```
Given I log in
When the dashboard loads
Then I see in this order (top to bottom):
  - Income / Expense / Net Balance cards (Rp)
  - Health Score card with Savings Rate tier + DTI + 50/30/20
  - Budget progress bars per category with OVER/UNDER labels
  - Top 5 spending categories
  - Upcoming cicilan due this month
  - Quick-Add button (prominent, floating)
```

## 4. Edge Cases & Unhappy Paths

### Cicilan
- **Delete cicilan with linked transactions:** Cannot delete — must unlink transactions first. Show warning: "5 transactions linked to this cicilan. Reassign first."
- **Zero monthly payment:** Not allowed — validation: cicilan_per_bulan > 0
- **Past due date:** Show "Overdue" badge with red highlight on dashboard

### Financial Health
- **Zero income month:** All rate metrics show "N/A — no income this month" instead of division errors
- **Negative savings:** Red indicator: "⚠️ Spending exceeds income by X"
- **DTI over 100%:** Critical red: "🔴 Monthly debt exceeds income"

### What-If
- **Input negative expense:** Expenses can't go below 0 — "Cannot reduce below 0"
- **Extreme values:** Income 10× current → still calculate but add note "This scenario is unlikely"

### CSV Import
- **Unknown bank format:** If columns don't match any preset, show manual mapping screen
- **Duplicate detection:** If same date+amount+description exists, ask "Skip or add as duplicate?"
- **Encoding issues:** Auto-detect UTF-8 / Latin-1, show preview of first 5 rows

### Share Link
- **Link accessed after revoke:** Shows "This shared view has been disabled"
- **Multiple devices:** Same link works on multiple devices — no device limit
