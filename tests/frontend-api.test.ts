import { describe, expect, it } from 'vitest';

async function frontendApi(fetchImpl: any) {
  const res = await fetchImpl();
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch {
      if (!res.ok) throw new Error(text || ("HTTP " + res.status));
      throw new Error("Server returned an invalid JSON response");
    }
  }
  if (!res.ok) throw new Error((data && data.error) || text || ("HTTP " + res.status));
  return data;
}

describe('frontend ledger API parsing', () => {
  it('surfaces unexpected non-JSON error responses without a JSON parse exception', async () => {
    await expect(frontendApi(async () => ({ ok: false, status: 404, text: async () => '404 Not Found' }))).rejects.toThrow('404 Not Found');
  });
});
