import { describe, expect, it, vi } from 'vitest';
import { extractFinancialDocumentWithOpenAI, getOpenAIRequestTimeoutMs, OpenAIClientError } from '../src/server/openai/client';

describe('OpenAI client timeout handling', () => {
  it('parses timeout env strings and falls back safely', () => {
    expect(getOpenAIRequestTimeoutMs({ OPENAI_REQUEST_TIMEOUT_MS: '120000' })).toBe(120000);
    expect(getOpenAIRequestTimeoutMs({ OPENAI_REQUEST_TIMEOUT_MS: 'nope' })).toBe(30000);
    expect(getOpenAIRequestTimeoutMs({})).toBe(30000);
  });
  it('distinguishes timeout errors and clears timeout', async () => {
    vi.useFakeTimers();
    const realClearTimeout = globalThis.clearTimeout;
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn((_url, init: any) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))));
    const promise = extractFinancialDocumentWithOpenAI({ OPENAI_API_KEY: 'sk-test', OPENAI_REQUEST_TIMEOUT_MS: '5' }, { name: 'a.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') });
    const handled = promise.catch(e => e);
    await vi.advanceTimersByTimeAsync(6);
    await expect(handled).resolves.toMatchObject({ code: 'openai_timeout' });
    expect(clearSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    globalThis.clearTimeout = realClearTimeout;
  });
  it('redacts secrets from HTTP errors', async () => {
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad sk-secret123 Bearer abc' } }) })));
    await expect(extractFinancialDocumentWithOpenAI({ OPENAI_API_KEY: 'sk-secret123' }, { name: 'a.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') })).rejects.toMatchObject({ code: 'openai_error', message: expect.not.stringContaining('sk-secret123') });
    vi.unstubAllGlobals();
  });
});
