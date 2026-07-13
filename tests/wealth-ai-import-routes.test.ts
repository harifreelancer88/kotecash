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
