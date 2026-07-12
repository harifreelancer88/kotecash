export const CSV_LIMITS = { maxFileSize: 2 * 1024 * 1024, maxRows: 2000, maxColumns: 60, maxCellLength: 10000 };
export type CsvError = { rowNumber: number; message: string };
export type CsvResult = { headers: string[]; rows: { rowNumber: number; values: string[]; raw: Record<string,string> }[]; errors: CsvError[] };

export function parseCsv(input: string | Uint8Array, limits = CSV_LIMITS): CsvResult {
  let text: string;
  if (input instanceof Uint8Array) {
    if (input.byteLength > limits.maxFileSize) throw new Error('CSV file exceeds 2 MB limit');
    if (input.includes(0)) throw new Error('Unsupported binary input');
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } else {
    const bytes = new TextEncoder().encode(input);
    if (bytes.byteLength > limits.maxFileSize) throw new Error('CSV file exceeds 2 MB limit');
    if (input.includes('\u0000')) throw new Error('Unsupported binary input');
    text = input;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records: { rowNumber:number; values:string[] }[] = [];
  const errors: CsvError[] = [];
  let row: string[] = [], cell = '', inQuotes = false, justClosed = false, rowNumber = 1, fieldStartRow = 1;
  function endCell(){ if(cell.length > limits.maxCellLength) errors.push({rowNumber:fieldStartRow,message:'Cell length exceeds limit'}); row.push(cell); cell=''; justClosed=false; fieldStartRow=rowNumber; }
  function endRow(){ endCell(); if(row.length > limits.maxColumns) errors.push({rowNumber,message:'Column count exceeds limit'}); records.push({rowNumber,values:row}); row=[]; }
  for (let i=0;i<text.length;i++) {
    const ch=text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i+1] === '"') { cell+='"'; i++; } else { inQuotes=false; justClosed=true; } }
      else { cell += ch; if (ch === '\n') rowNumber++; }
      continue;
    }
    if (justClosed && ch !== ',' && ch !== '\n' && ch !== '\r') { errors.push({rowNumber,message:'Malformed CSV quote structure'}); justClosed=false; }
    if (ch === '"') { if (cell.length === 0) inQuotes = true; else errors.push({rowNumber,message:'Unexpected quote in unquoted field'}); }
    else if (ch === ',') endCell();
    else if (ch === '\n') { endRow(); rowNumber++; fieldStartRow=rowNumber; }
    else if (ch === '\r') { if (text[i+1] === '\n') { endRow(); i++; rowNumber++; fieldStartRow=rowNumber; } else { endRow(); rowNumber++; fieldStartRow=rowNumber; } }
    else cell += ch;
  }
  if (inQuotes) errors.push({ rowNumber: fieldStartRow, message: 'Unclosed quoted field' });
  if (cell.length || row.length || text.endsWith(',') || text.length === 0) endRow();
  if (records.length === 0) return { headers: [], rows: [], errors };
  const headers = records[0].values.map(h => h.trim());
  if (headers.length > limits.maxColumns) errors.push({ rowNumber: 1, message: 'Column count exceeds limit' });
  const rows = records.slice(1).filter(r => r.values.some(v => v !== '')).map(r => {
    if (r.values.length !== headers.length) errors.push({ rowNumber: r.rowNumber, message: 'Row column count does not match headers' });
    const raw: Record<string,string> = {}; headers.forEach((h,i)=>{ raw[h || `column_${i+1}`] = r.values[i] ?? ''; });
    return { rowNumber: r.rowNumber, values: r.values, raw };
  });
  if (rows.length > limits.maxRows) errors.push({ rowNumber: limits.maxRows + 2, message: 'Row count exceeds 2000 limit' });
  return { headers, rows, errors };
}
