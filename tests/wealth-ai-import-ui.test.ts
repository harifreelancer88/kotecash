import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

const context = createContext({ setTimeout: (...args: any[]) => setTimeout(...args), clearTimeout: (id: any) => clearTimeout(id), fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => [] }), document: { getElementById: () => null, querySelectorAll: () => [] }, module: { exports: {} }, globalThis: {} });
new Script(readFileSync('public/js/wealth/ai-import.js', 'utf8')).runInContext(context);
const AI = context.module.exports as any;

describe('wealth AI import UI helpers', () => {
  it('shows CSV consent only for CSV files', () => {
    expect(AI.csvConsentVisible({ name: 'trades.csv', type: '' })).toBe(true);
    expect(AI.csvConsentVisible({ name: 'trades.txt', type: 'text/csv' })).toBe(true);
    expect(AI.csvConsentVisible({ name: 'statement.pdf', type: 'application/pdf' })).toBe(false);
    expect(AI.csvConsentVisible({ name: 'scan.png', type: 'image/png' })).toBe(false);
  });
  it('resets CSV consent when changing from CSV to non-CSV', () => {
    expect(AI.shouldResetCsvConsent({ name: 'a.csv', type: 'text/csv' }, { name: 'a.pdf', type: 'application/pdf' })).toBe(true);
    expect(AI.shouldResetCsvConsent({ name: 'a.pdf', type: 'application/pdf' }, { name: 'b.csv', type: 'text/csv' })).toBe(false);
    expect(AI.shouldResetCsvConsent({ name: 'a.csv', type: 'text/csv' }, { name: 'b.csv', type: 'text/csv' })).toBe(false);
  });
});

const waitMicrotasks = () => Promise.resolve();

describe('wealth AI import UI readiness and polling', () => {
  it('enables prepare only for extracted or ready_for_import', () => {
    expect(AI.canPrepare({ status: 'extracted' })).toBe(true);
    expect(AI.canPrepare({ status: 'ready_for_import' })).toBe(true);
    for (const status of ['processing', 'failed', 'validation_failed', 'deleted']) expect(AI.canPrepare({ status })).toBe(false);
  });
  it('classifies polling terminal statuses', () => {
    expect(AI.isTerminalStatus('extracted')).toBe(true);
    expect(AI.isTerminalStatus('failed')).toBe(true);
    expect(AI.isTerminalStatus('processing')).toBe(false);
  });
  it('frontend polling stops on success', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let statusCalls=0; context.fetch = async (url: string) => { calls.push(url); return { ok: true, headers: { get: () => 'application/json' }, json: async () => { if(url === '/api/wealth/ai-imports/7') statusCalls++; return url === '/api/wealth/ai-imports/7' ? (statusCalls === 1 ? { id: 7, status: 'processing' } : { id: 7, status: 'extracted' }) : []; } }; };
    AI.pollExtraction(7, 10000);
    await waitMicrotasks();
    await vi.advanceTimersByTimeAsync(4000);
    await waitMicrotasks();
    await vi.advanceTimersByTimeAsync(8000);
    expect(calls.filter(u => u === '/api/wealth/ai-imports/7')).toHaveLength(2);
    vi.useRealTimers();
  });
  it('frontend polling stops on failure', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let statusCalls=0; context.fetch = async (url: string) => { calls.push(url); return { ok: true, headers: { get: () => 'application/json' }, json: async () => { if(url === '/api/wealth/ai-imports/7') statusCalls++; return url === '/api/wealth/ai-imports/7' ? { id: 7, status: statusCalls === 1 ? 'processing' : 'failed', error_message: 'Retry safely' } : []; } }; };
    AI.pollExtraction(7, 10000);
    await waitMicrotasks();
    await vi.advanceTimersByTimeAsync(4000);
    await waitMicrotasks();
    await vi.advanceTimersByTimeAsync(8000);
    expect(calls.filter(u => u === '/api/wealth/ai-imports/7')).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe('wealth AI import prepare payload', () => {
  it('submits selected numeric account_id field expected by backend', () => {
    const originalDocument = context.document;
    context.document = {
      getElementById: (id: string) => ({ value: id === 'ai-account' ? '9' : '2026-04-01' }),
      querySelectorAll: () => [],
    } as any;
    expect(AI.preparePayload()).toEqual({ account_id: 9, cutover_date: '2026-04-01' });
    context.document = originalDocument;
  });
});
