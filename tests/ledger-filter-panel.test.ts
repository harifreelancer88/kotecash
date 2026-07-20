import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

function context() {
  const c = createContext({
    Intl, Number, String, Math, Set, Date,
    URLSearchParams,
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    window: { addEventListener() {}, location: { href: '', search: '' }, history: { pushState() {} }, scrollTo() {} },
    console, fetch() { throw new Error('not called'); },
  });
  new Script(readFileSync('public/app.js', 'utf8')).runInContext(c);
  c.M.expenseCats = ['Food'];
  c.M.incomeCats = ['Salary'];
  return c as any;
}

const labelFor = (html: string, id: string, text: string) => html.includes(`<label for="${id}" class="ledger-filter-label">${text}</label>`);
const count = (html: string, pattern: RegExp) => (html.match(pattern) || []).length;

describe('ledger mobile filter panel', () => {
  it('renders persistent labels associated to every visible filter control', () => {
    const c = context();
    c.ledgerState.filters.dateMode = 'range';
    const html = c.renderLedgerControls();
    expect(labelFor(html, 'ledCat', 'Category')).toBe(true);
    expect(labelFor(html, 'ledType', 'Transaction type')).toBe(true);
    expect(labelFor(html, 'ledDateMode', 'Date filter')).toBe(true);
    expect(labelFor(html, 'ledFrom', 'From date')).toBe(true);
    expect(labelFor(html, 'ledTo', 'To date')).toBe(true);
    for (const id of ['ledCat', 'ledType', 'ledDateMode', 'ledFrom', 'ledTo']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('renders zero date inputs for All dates', () => {
    const c = context();
    c.ledgerState.filters.dateMode = 'all';
    const html = c.renderLedgerControls();
    expect(count(html, /type="date"/g)).toBe(0);
    expect(count(html, /type="month"/g)).toBe(0);
  });

  it('renders exactly one date input for Specific date', () => {
    const c = context();
    c.ledgerState.filters.dateMode = 'specific';
    const html = c.renderLedgerControls();
    expect(labelFor(html, 'ledDate', 'Transaction date')).toBe(true);
    expect(count(html, /type="date"/g)).toBe(1);
    expect(count(html, /type="month"/g)).toBe(0);
  });

  it('renders exactly two date inputs for Date range', () => {
    const c = context();
    c.ledgerState.filters.dateMode = 'range';
    const html = c.renderLedgerControls();
    expect(labelFor(html, 'ledFrom', 'From date')).toBe(true);
    expect(labelFor(html, 'ledTo', 'To date')).toBe(true);
    expect(count(html, /type="date"/g)).toBe(2);
    expect(count(html, /type="month"/g)).toBe(0);
  });

  it('renders exactly one month input for Month', () => {
    const c = context();
    c.ledgerState.filters.dateMode = 'month';
    const html = c.renderLedgerControls();
    expect(labelFor(html, 'ledMonth', 'Month')).toBe(true);
    expect(count(html, /type="date"/g)).toBe(0);
    expect(count(html, /type="month"/g)).toBe(1);
  });

  it('changing modes removes irrelevant controls and stale date values from filtering', () => {
    const c = context();
    const f = c.ledgerState.filters;
    Object.assign(f, { dateMode: 'all', date: '2026-07-20', from: '2026-07-01', to: '2026-07-31', month: '2026-07' });
    const html = c.renderLedgerControls();
    expect(html).not.toContain('id="ledDate"');
    expect(html).not.toContain('id="ledFrom"');
    expect(html).not.toContain('id="ledTo"');
    expect(html).not.toContain('id="ledMonth"');
    expect(c.ledgerDateRange()).toEqual({});
    expect(f).toMatchObject({ date: '', from: '', to: '', month: '' });
  });

  it('submits only the active date mode values to filtering', () => {
    const c = context();
    const f = c.ledgerState.filters;
    Object.assign(f, { dateMode: 'specific', date: '2026-07-20', from: '2026-07-01', to: '2026-07-31', month: '2026-07' });
    c.clearLedgerDateValuesForMode(f);
    expect(c.ledgerDateRange()).toEqual({ from: '2026-07-20', to: '2026-07-20' });
    Object.assign(f, { dateMode: 'month', date: '2026-07-20', from: '2026-07-01', to: '2026-07-31', month: '2026-07' });
    c.clearLedgerDateValuesForMode(f);
    expect(c.ledgerDateRange()).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('Clear all resets search, filters, date mode, and date values', () => {
    const c = context();
    Object.assign(c.ledgerState.filters, { q: 'coffee', cat: 'Food', type: 'expense', dateMode: 'range', date: '2026-07-20', from: '2026-07-01', to: '2026-07-31', month: '2026-07' });
    c.renderPage = () => '';
    c.clearLedgerFilters();
    expect(c.ledgerState.filters).toEqual({ q: '', cat: '', type: '', dateMode: 'all', date: '', from: '', to: '', month: '' });
  });

  it('keeps date and month input text visible for Chrome Android', () => {
    const css = readFileSync('src/styles/globals.css', 'utf8');
    expect(css).toContain('-webkit-text-fill-color:var(--c-ink)');
    expect(css).toContain('color-scheme:light');
    expect(css).toContain('::-webkit-calendar-picker-indicator');
  });

  it('preserves existing category, type, notes, date filtering and selection', () => {
    const c = context();
    c.M.txns = [
      { id: 1, desc: 'Coffee', cat: 'Food', type: 'expense', date: '2026-07-20' },
      { id: 2, desc: 'Salary', cat: 'Salary', type: 'income', date: '2026-07-31' },
    ];
    Object.assign(c.ledgerState.filters, { q: 'cof', cat: 'Food', type: 'expense', dateMode: 'specific', date: '2026-07-20' });
    expect(c.getFilteredLedgerRows().map((t: any) => t.id)).toEqual([1]);
    c.toggleLedgerSelection(1, true);
    expect(c.ledgerState.selectionMode).toBe(true);
    expect(c.ledgerState.selected.has('1')).toBe(true);
  });
});
