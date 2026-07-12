import { describe, expect, it } from 'vitest';
import { parseCsv, CSV_LIMITS } from '../src/server/wealth/csv';

describe('wealth CSV parser', () => {
  it('parses simple CSV', () => { const r=parseCsv('a,b\n1,2'); expect(r.headers).toEqual(['a','b']); expect(r.rows[0].raw).toEqual({a:'1',b:'2'}); });
  it('parses quoted commas', () => { expect(parseCsv('a,b\n"x,y",2').rows[0].raw.a).toBe('x,y'); });
  it('parses escaped quotes', () => { expect(parseCsv('a\n"x""y"').rows[0].raw.a).toBe('x"y'); });
  it('parses quoted line breaks', () => { expect(parseCsv('a,b\n"x\ny",2').rows[0].raw.a).toBe('x\ny'); });
  it('strips BOM', () => { expect(parseCsv('\ufeffa\n1').headers).toEqual(['a']); });
  it('parses CRLF', () => { expect(parseCsv('a,b\r\n1,2\r\n').rows[0].raw.b).toBe('2'); });
  it('preserves blank cells', () => { expect(parseCsv('a,b,c\n1,,3').rows[0].raw.b).toBe(''); });
  it('reports malformed quotes', () => { expect(parseCsv('a\n"oops').errors[0].message).toMatch(/Unclosed/); });
  it('rejects file-size limit', () => { expect(()=>parseCsv('a\n1',{...CSV_LIMITS,maxFileSize:1})).toThrow(/2 MB|limit/); });
  it('reports row-count limit', () => { const r=parseCsv('a\n1\n2',{...CSV_LIMITS,maxRows:1}); expect(r.errors.some(e=>e.message.includes('Row count'))).toBe(true); });
  it('reports column-count limit', () => { const r=parseCsv('a,b\n1,2',{...CSV_LIMITS,maxColumns:1}); expect(r.errors.some(e=>e.message.includes('Column count'))).toBe(true); });
  it('reports cell-length limit', () => { const r=parseCsv('a\nabcdef',{...CSV_LIMITS,maxCellLength:3}); expect(r.errors.some(e=>e.message.includes('Cell length'))).toBe(true); });
});
