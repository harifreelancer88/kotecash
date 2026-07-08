export interface Earmark {
  goal_id: number;
  source_type: string; // 'wallet' | 'deposit' | 'portfolio'
  source_id: number;
  amount: number;
}

export interface AmortizationRecord {
  month: number;
  monthly: number;
  principalPayment: number;
  interestPayment: number;
  remaining: number;
}

export interface ScenarioResult {
  newIncome: number;
  newExpense: number;
  newNet: number;
  newSR: number;
  newDTI: number;
}

export interface Movement {
  src_kind: string | null;
  src_id: number | null;
  dst_kind: string | null;
  dst_id: number | null;
  amount: number;
  date: string;
  category_id?: number | null;
}

export interface Snapshot {
  entity_kind: string;
  entity_id: number;
  amount: number;
  recorded_at: string;
}

/**
 * Calculates total earmarked amount for a wallet
 */
export function walletEarmarked(walletId: number, earmarks: Earmark[]): number {
  return earmarks
    .filter(e => e.source_type === 'wallet' && e.source_id === walletId)
    .reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Calculates free spendable balance of a wallet
 */
export function walletFree(balance: number, earmarked: number): number {
  return balance - earmarked;
}

/**
 * Calculates total earmarked progress towards a goal
 */
export function goalProgress(goalId: number, earmarks: Earmark[]): number {
  return earmarks
    .filter(e => e.goal_id === goalId)
    .reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Calculates potential savings rate
 */
export function savingsRate(income: number, expense: number): number {
  if (income <= 0) return 0;
  return (income - expense) / income;
}

/**
 * Calculates debt-to-income ratio
 */
export function dtiRatio(income: number, monthlyDebt: number): number {
  if (income <= 0) return 0;
  return monthlyDebt / income;
}

/**
 * Determines budget status based on actual vs budget spending
 */
export function budgetStatus(actual: number, budget: number): 'OVER' | 'ON TRACK' | 'UNDER' {
  if (budget <= 0) {
    return actual > 0 ? 'OVER' : 'UNDER';
  }
  const ratio = actual / budget;
  if (ratio > 1.00) return 'OVER';
  if (ratio > 0.90) return 'ON TRACK';
  return 'UNDER';
}

/**
 * Returns color string for credit card utilization based on balance and limit
 */
export function ccUtilizationColor(balance: number, limit: number): 'red' | 'amber' | 'green' {
  if (limit <= 0) {
    return balance > 0 ? 'red' : 'green';
  }
  const utilization = balance / limit;
  if (utilization > 0.50) return 'red';
  if (utilization > 0.30) return 'amber';
  return 'green';
}

/**
 * Generates an amortization schedule for installment debt
 */
export function amortizationSchedule(
  sisa: number,
  bunga: number,
  monthly: number,
  monthsLeft: number
): AmortizationRecord[] {
  const schedule: AmortizationRecord[] = [];
  let remaining = sisa;
  const monthlyRate = bunga / 100 / 12;

  for (let month = 1; month <= monthsLeft; month++) {
    let interestPayment = Math.round(remaining * monthlyRate);
    let principalPayment = monthly - interestPayment;

    if (month === monthsLeft) {
      principalPayment = remaining;
      interestPayment = monthly - principalPayment;
    }

    remaining -= principalPayment;
    if (month === monthsLeft) {
      remaining = 0;
    }

    schedule.push({
      month,
      monthly,
      principalPayment,
      interestPayment,
      remaining,
    });
  }

  return schedule;
}

/**
 * Simulates a what-if scenario for changes in income/expenses
 */
export function newScenario(
  income: number,
  expense: number,
  incomeChangePct: number,
  expenseChangePct: number,
  totalMonthlyDebt: number
): ScenarioResult {
  const newIncome = income * (1 + incomeChangePct / 100);
  const newExpense = expense * (1 + expenseChangePct / 100);
  const newNet = newIncome - newExpense;
  const newSR = newIncome > 0 ? newNet / newIncome : 0;
  const newDTI = newIncome > 0 ? totalMonthlyDebt / newIncome : 0;

  return {
    newIncome,
    newExpense,
    newNet,
    newSR,
    newDTI,
  };
}

const LIABILITY_KINDS = new Set(['cicilan', 'credit_card']);

/**
 * Current balance of any account kind EXCEPT portfolio (use portfolioValue for that).
 * base = wallets.initial_balance / cicilan.total_utang / 0 otherwise.
 * Asset: dst adds, src subtracts. Liability: src adds to owed, dst reduces owed.
 */
export function accountBalance(
  kind: string,
  id: number,
  base: number,
  movements: Movement[]
): number {
  const isLiability = LIABILITY_KINDS.has(kind);
  let bal = base;
  for (const m of movements) {
    if (m.src_kind === kind && m.src_id === id) bal += isLiability ? m.amount : -m.amount;
    if (m.dst_kind === kind && m.dst_id === id) bal += isLiability ? -m.amount : m.amount;
  }
  return bal;
}

/**
 * Portfolio current value = latest balance_history snapshot − Σ outflows since.
 */
export function portfolioValue(
  portfolioId: number,
  snapshots: Snapshot[],
  movements: Movement[]
): number {
  const ours = snapshots
    .filter((s) => s.entity_kind === 'portfolio' && s.entity_id === portfolioId)
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
  if (!ours.length) return 0;
  const latest = ours[0];
  const cutoff = latest.recorded_at.slice(0, 10);
  const outflows = movements
    .filter((m) => m.src_kind === 'portfolio' && m.src_id === portfolioId && m.date > cutoff)
    .reduce((s, m) => s + m.amount, 0);
  return latest.amount - outflows;
}

/**
 * Income/expense for a 'YYYY-MM' from a movement set.
 * income  = Σ(src IS NULL) this month  (outside → account)
 * expense = Σ(dst IS NULL) this month  (account → outside; debt payments have real dst)
 */
export function pnl(movements: Movement[], month: string) {
  let income = 0;
  let expense = 0;
  for (const m of movements) {
    if (!m.date.startsWith(month)) continue;
    if (m.src_kind === null) income += m.amount;
    if (m.dst_kind === null) expense += m.amount;
  }
  return { income, expense };
}
