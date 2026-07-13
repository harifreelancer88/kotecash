import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

const extractMock = vi.fn(async () => ({
  json: { document: { document_type: 'holdings_statement', account_number_masked: '12345678' }, holdings: [], transactions: [] },
  response_id: 'resp_1',
  model: 'test-model',
  usage: null,
}));

vi.mock('../src/server/openai/client', () => ({
  OpenAIClientError: class OpenAIClientError extends Error { constructor(message: string, public code: string, public status?: number) { super(message); } },
  extractFinancialDocumentWithOpenAI: extractMock,
}));

const { default: wealthAiImports } = await import('../src/server/routes/wealth-ai-imports');

function mockDB() {
  const queries: string[] = [];
  const prepare = vi.fn((query: string) => {
    queries.push(query);
    return { bind: vi.fn(() => ({
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true, meta: { last_row_id: 42, changes: 1 } })),
    })) };
  });
  return { db: { prepare } as unknown as D1Database, queries };
}
function harness(db: D1Database) { const app = new Hono<{ Variables: { userId: number } }>(); app.use('*', async (c, next) => { c.set('userId', 1); await next(); }); app.route('/api/wealth/ai-import', wealthAiImports); return { app, env: { DB: db, OPENAI_API_KEY: 'sk-test' } as any }; }
async function postFile(file: File, fields: Record<string, string> = {}) {
  const m = mockDB(); const h = harness(m.db); const fd = new FormData(); fd.append('file', file); fd.append('document_type', fields.document_type || 'unknown'); for (const [k, v] of Object.entries(fields)) if (k !== 'document_type') fd.append(k, v); const res = await h.app.request('/api/wealth/ai-import/extract', { method: 'POST', body: fd }, h.env); return { res, queries: m.queries };
}

describe('wealth AI import extraction route', () => {
  it('rejects CSV extraction without explicit consent', async () => {
    extractMock.mockClear();
    const { res } = await postFile(new File(['symbol,quantity\nABC,1\n'], 'holdings.csv', { type: 'text/csv' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'CSV AI interpretation must be explicitly selected' });
    expect(extractMock).not.toHaveBeenCalled();
  });
  it('accepts CSV extraction with explicit consent during route validation', async () => {
    extractMock.mockClear();
    const { res } = await postFile(new File(['symbol,quantity\nABC,1\n'], 'holdings.csv', { type: 'text/csv' }), { allow_csv_ai_interpretation: 'true', document_type: 'holdings_statement' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 42, status: 'extracted' });
    expect(extractMock).toHaveBeenCalledOnce();
  });
  it('does not require CSV consent for PDF or image extraction', async () => {
    extractMock.mockClear();
    const pdf = await postFile(new File(['%PDF-1.7'], 'note.pdf', { type: 'application/pdf' }), { document_type: 'broker_contract_note' });
    const img = await postFile(new File(['img'], 'scan.png', { type: 'image/png' }), { document_type: 'unknown' });
    expect(pdf.res.status).toBe(200);
    expect(img.res.status).toBe(200);
    expect(extractMock).toHaveBeenCalledTimes(2);
  });
  it('does not create finance records during extraction', async () => {
    const { res, queries } = await postFile(new File(['%PDF-1.7'], 'statement.pdf', { type: 'application/pdf' }));
    expect(res.status).toBe(200);
    expect(queries.join('\n')).not.toMatch(/INSERT INTO wealth_(transactions|holdings|prices|assets|accounts)\b/i);
  });
});

describe('wealth AI import schema hardening queries', () => {
  it('writes and reads the final ai_document_extractions status fields', async () => {
    extractMock.mockClear();
    const { res, queries } = await postFile(new File(['%PDF-1.7'], 'statement.pdf', { type: 'application/pdf' }));
    expect(res.status).toBe(200);
    const sql = queries.join('\n');
    expect(sql).toMatch(/processing_started_at/);
    expect(sql).toMatch(/completed_at=datetime\('now'\)/);
    expect(sql).toMatch(/error_code=NULL/);
    expect(sql).toMatch(/error_message=NULL/);
  });

  it('returns a safe database-update message instead of raw D1 schema errors', async () => {
    const prepare = vi.fn((query: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => null),
        all: vi.fn(async () => {
          throw new Error('D1_ERROR: no such column: error_code: SQLITE_ERROR');
        }),
        run: vi.fn(async () => {
          if (/UPDATE ai_document_extractions SET status='failed'/.test(query)) return { success: true, meta: { changes: 0 } };
          throw new Error('D1_ERROR: no such column: error_code: SQLITE_ERROR');
        }),
      })),
    }));
    const h = harness({ prepare } as unknown as D1Database);
    const res = await h.app.request('/api/wealth/ai-import', {}, h.env);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'AI extraction is temporarily unavailable. Please retry after the database update.',
      code: 'database_schema_update_required',
    });
  });
});

describe('wealth AI prepare regression', () => {
  function prepareHarness(opts:any={}) {
    const insertedRows:any[]=[]; let batchSeq=100;
    const extraction={id:5,user_id:1,file_name:'h.pdf',file_hash:'hash5',status:'extracted',deleted_at:null,extracted_json:JSON.stringify({document:{document_type:'holdings_statement'},holdings:opts.holdings||[{asset_name:'Reliance Industries',symbol:'RELIANCE',isin:'INE002A01018',exchange:'NSE',quantity:'2',average_cost:'100.40',confidence:0.9}]})};
    const account={id:9,name:'Zerodha',account_type:'brokerage'};
    const otherAccount=null;
    const asset=opts.asset===undefined?{id:11,name:'Reliance Industries',asset_type:'stock',symbol:'RELIANCE',isin:'INE002A01018',exchange:'NSE'}:opts.asset;
    const prepare=vi.fn((query:string)=>({bind:vi.fn((...binds:any[])=>({
      first:vi.fn(async()=>{
        if(query.includes('FROM ai_document_extractions')) return extraction;
        if(query.includes('FROM portfolios')) return binds[0]===9?account:otherAccount;
        if(query.includes('FROM investment_assets')) return asset;
        return null;
      }),
      all:vi.fn(async()=>({results:query.includes('FROM investment_assets') && asset ? [asset] : []})),
      run:vi.fn(async()=>{ if(query.includes('INSERT INTO wealth_import_rows')) insertedRows.push({raw:JSON.parse(binds[3]),normalized:binds[4]?JSON.parse(binds[4]):null,status:binds[6],error:binds[8]}); return {success:true,meta:{last_row_id: query.includes('wealth_import_batches')?batchSeq:1,changes:1}}; }),
    }))}));
    const h=harness({prepare} as unknown as D1Database);
    return {h,insertedRows,prepare};
  }
  it('applies selected target account ID, resolves account name, derives quantity × average cost, and does not use confidence as price', async()=>{
    const {h,insertedRows}=prepareHarness();
    const res=await h.app.request('/api/wealth/ai-import/5/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account_id:9,cutover_date:'2026-04-01'})},h.env);
    expect(res.status).toBe(200);
    const json:any=await res.json();
    expect(json.valid_rows).toBe(1);
    expect(json.rows[0].account.name).toBe('Zerodha');
    expect(insertedRows[0].raw.account_name).toBe('Zerodha');
    expect(insertedRows[0].normalized.account.id).toBe(9);
    expect(insertedRows[0].normalized.asset.id).toBe(11);
    expect(insertedRows[0].normalized.unit_price).toBe('100.4');
    expect(insertedRows[0].normalized.gross_amount).toBe(201);
    expect(insertedRows[0].normalized.net_amount).toBe(201);
    expect(insertedRows[0].normalized.unit_price).not.toBe('0.9');
  });
  it('rejects another user account ID during prepare', async()=>{
    const {h}=prepareHarness();
    const res=await h.app.request('/api/wealth/ai-import/5/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account_id:99})},h.env);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({error:'Invalid default account'});
  });
  it('uses extracted total_cost when present', async()=>{
    const {h,insertedRows}=prepareHarness({holdings:[{asset_name:'Reliance Industries',symbol:'RELIANCE',isin:'INE002A01018',exchange:'NSE',quantity:'2',average_cost:'100.40',total_cost:'250',confidence:0.9}]});
    const res=await h.app.request('/api/wealth/ai-import/5/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account_id:9})},h.env);
    expect(res.status).toBe(200);
    expect(insertedRows[0].normalized.gross_amount).toBe(250);
    expect(insertedRows[0].normalized.net_amount).toBe(250);
  });
  it('marks missing assets as candidate creations instead of blank asset', async()=>{
    const {h,insertedRows}=prepareHarness({asset:null,holdings:[{asset_name:'NewCo',symbol:'NEWCO',isin:'INE000X01010',exchange:'NSE',quantity:'1',average_cost:'10'}]});
    const res=await h.app.request('/api/wealth/ai-import/5/prepare',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account_id:9})},h.env);
    expect(res.status).toBe(200);
    expect(insertedRows[0].status).toBe('valid');
    expect(insertedRows[0].normalized.asset.candidate).toMatchObject({name:'NewCo',symbol:'NEWCO',isin:'INE000X01010',exchange:'NSE',asset_type:'stock'});
  });
});
