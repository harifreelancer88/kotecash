import { describe, it, expect } from 'vitest';
import { advanceNextRun } from '../src/server/routes/recurring';

describe('advanceNextRun', () => {
  it('monthly: rolls day_of_month forward one month', () => {
    expect(advanceNextRun({ frequency: 'monthly', day_of_month: 5, month_of_year: null, weekday: null }, '2026-06-06'))
      .toBe('2026-07-05');
  });
  it('yearly: rolls month_of_year/day forward one year', () => {
    expect(advanceNextRun({ frequency: 'yearly', day_of_month: 10, month_of_year: 3, weekday: null }, '2026-03-11'))
      .toBe('2027-03-10');
  });
  it('monthly day-of-month clamps to month length', () => {
    expect(advanceNextRun({ frequency: 'monthly', day_of_month: 31, month_of_year: null, weekday: null }, '2026-01-31'))
      .toBe('2026-02-28');
  });
});
