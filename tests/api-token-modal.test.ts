import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = () => readFileSync('public/app.js', 'utf8');

describe('API token modal stability regressions', () => {
  it('renders Generate as a non-submit button and opens the explicit token modal', () => {
    const src = app();
    expect(src).toContain('id="generateTokenBtn" type="button"');
    expect(src).toContain('onclick="openTokenModal(event)"');
  });

  it('does not route-reload the API page when refreshing tokens', () => {
    const src = app();
    expect(src).toContain('if (id === "api") loadTokens({ render: false });');
    expect(src).toContain('async function loadTokens(opts)');
    expect(src).not.toContain('async function loadTokens() { try { M._tokens = await api("/api/tokens"); navigate("api");');
  });

  it('keeps the one-time token in modal state after list refresh succeeds or fails', () => {
    const src = app();
    expect(src).toContain('tokenModalState.token = String(r && r.token || "")');
    expect(src).toContain('await loadTokens({ render: true });');
    expect(src).toContain('Token was created, but the token list could not be refreshed.');
    expect(src).toContain('This token is shown only once. Copy it before closing.');
  });

  it('prevents duplicate POSTs while submitting', () => {
    const src = app();
    expect(src).toContain('if (tokenModalState.submitting || tokenModalState.phase === "created") return;');
    expect(src).toContain('tokenModalState.submitting = true');
    expect(src).toContain('id="tokenSubmitBtn" type="submit"');
  });

  it('uses Clipboard API first and falls back without hiding the token', () => {
    const src = app();
    expect(src).toContain('navigator.clipboard.writeText(token)');
    expect(src).toContain('document.execCommand("copy")');
    expect(src).toContain('Copy failed. The token remains visible so you can copy it manually.');
  });

  it('does not persist or leak the full token through browser storage, URL, or console logging', () => {
    const src = app();
    expect(src).not.toMatch(/console\.log\([^)]*token/i);
    expect(src).not.toMatch(/localStorage\.[^(]*(?:token|createdToken)/i);
    expect(src).not.toMatch(/sessionStorage\.[^(]*(?:token|createdToken)/i);
    expect(src).not.toMatch(/searchParams\.set\([^)]*token/i);
  });

  it('blocks background only while a visible modal is present and restores scroll on close', () => {
    const src = app();
    expect(src).toContain('document.body.classList.add("modal-open")');
    expect(src).toContain('document.body.classList.remove("modal-open")');
    expect(src).toContain('document.querySelectorAll(".modal-mask").forEach(function (m) { m.remove(); });');
  });
});
