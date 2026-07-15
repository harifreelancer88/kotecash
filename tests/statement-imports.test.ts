import { describe, expect, it } from 'vitest';
import { normalize, parseDate, parseStatementCsv, suggest, validateNormalized, STATEMENT_LIMITS } from '../src/server/imports/statement';

describe('Phase 15 statement import parsing and mapping', () => {
  it('parses BOM, CRLF, quoted commas, and multiline cells', () => {
    const csv = '\ufeffDate,Description,Debit,Credit,Balance\r\n2026-07-01,"Cafe, lunch",100,,900\r\n2026-07-02,"Salary\nJuly",,1000,1900\r\n';
    const parsed = parseStatementCsv(new TextEncoder().encode(csv));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].raw.Description).toBe('Cafe, lunch');
    expect(parsed.rows[1].raw.Description).toBe('Salary\nJuly');
  });

  it('suggests debit-credit bank mapping and normalizes directions', () => {
    const headers = ['Date', 'Description', 'Reference Number', 'Debit', 'Credit', 'Balance'];
    const s = suggest(headers);
    expect(s.import_type).toBe('bank_statement');
    const debit = normalize({ Date:'15/07/2026', Description:'Groceries', Debit:'1,250', Credit:'', Balance:'8,750' }, s.column_mapping, { date_format:'dd/mm/yyyy' });
    expect(debit.normalized_date).toBe('2026-07-15');
    expect(debit.normalized_amount).toBe(1250);
    expect(debit.normalized_direction).toBe('debit');
    expect(validateNormalized(debit)).toBeNull();
    const credit = normalize({ Date:'2026-07-16', Description:'Interest', Debit:'', Credit:'50', Balance:'8,800' }, s.column_mapping, {});
    expect(credit.normalized_direction).toBe('credit');
    expect(credit.normalized_type).toBe('interest_income');
  });

  it('supports signed amount inversion and invalid date validation', () => {
    const row = { Date:'not-a-date', Description:'Refund', Amount:'-500' };
    const n = normalize(row, { date:'Date', description:'Description', amount:'Amount' }, { invert_sign:true });
    expect(n.normalized_direction).toBe('credit');
    expect(validateNormalized(n)).toMatch(/date/i);
    expect(parseDate('07/15/2026', 'mm/dd/yyyy')).toBe('2026-07-15');
  });

  it('enforces oversized row limit', () => {
    const rows = Array.from({length: STATEMENT_LIMITS.maxRows + 1}, (_,i)=>`2026-07-01,Txn ${i},1`).join('\n');
    const parsed = parseStatementCsv(new TextEncoder().encode(`Date,Description,Debit\n${rows}`));
    expect(parsed.errors.some(e => /Row count exceeds/.test(e.message))).toBe(true);
  });
});
