import { describe, it, expect, vi } from "vitest";
import { app } from "../src/server/app";

// Helper to mock D1Database prepare chain
function createMockDB(options: {
  firstResult?: any;
  runResult?: any;
  countResult?: { count: number };
}) {
  const mockPrepare = vi.fn().mockImplementation((query: string) => {
    const boundAll = vi.fn().mockResolvedValue({ results: [] });
    const boundFirst = vi.fn().mockImplementation(async () => {
      if (query.includes("COUNT(*)")) {
        return options.countResult ?? { count: 1 };
      }
      return options.firstResult;
    });
    const boundRun = vi.fn().mockResolvedValue(
      options.runResult ?? { success: true, meta: { last_row_id: 1 } }
    );
    return {
      bind: vi.fn().mockImplementation((...args: any[]) => {
        return { first: boundFirst, run: boundRun, all: boundAll };
      }),
      first: boundFirst,
      run: boundRun,
      all: boundAll,
    };
  });

  return { prepare: mockPrepare } as unknown as D1Database;
}

// SHA-256 helper for tests
async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("kotecash API & Auth", () => {
  it("allows login with correct credentials", async () => {
    const passwordHash = await sha256("mysecretpassword");
    const mockDB = createMockDB({
      firstResult: {
        id: 42,
        email: "test@example.com",
        password_hash: passwordHash,
      },
    });

    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "mysecretpassword" }),
      },
      { DB: mockDB }
    );

    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.success).toBe(true);
    expect(body.user.id).toBe(42);
    expect(body.user.email).toBe("test@example.com");

    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toContain("session=42");
  });

  it("denies login with invalid credentials", async () => {
    const passwordHash = await sha256("mysecretpassword");
    const mockDB = createMockDB({
      firstResult: {
        id: 42,
        email: "test@example.com",
        password_hash: passwordHash,
      },
    });

    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", password: "wrongpassword" }),
      },
      { DB: mockDB }
    );

    expect(res.status).toBe(401);
    const body = await res.json<any>();
    expect(body.error).toBe("Invalid credentials");
  });

  it("handles empty user table on login by auto-creating admin", async () => {
    // firstResult is null (user not found), countResult is { count: 0 } (empty users table)
    const mockDB = createMockDB({
      firstResult: null,
      countResult: { count: 0 },
    });

    // Mock query calls
    const mockPrepare = mockDB.prepare as any;

    const res = await app.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@example.com", password: "admin" }),
      },
      { DB: mockDB }
    );

    // It will return 401 because the second lookup for the newly created admin user in index.ts returned null from firstResult,
    // but the DB prepare should have been called with the INSERT statement.
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO users")
    );
  });

  it("restricts /api/* endpoints if unauthorized", async () => {
    const mockDB = createMockDB({});
    const res = await app.request("/api/wallets", {}, { DB: mockDB });
    expect(res.status).toBe(401);
    const body = await res.json<any>();
    expect(body.error).toBe("Unauthorized");
  });

  it("allows access with valid session cookie", async () => {
    const mockDB = createMockDB({
      firstResult: { id: 42, email: "test@example.com" },
    });

    const res = await app.request(
      "/api/wallets",
      {
        headers: { Cookie: "session=42" },
      },
      { DB: mockDB }
    );

    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body).toEqual([]);
  });

  it("allows access with valid Bearer token and updates last_used_at", async () => {
    const mockDB = createMockDB({
      firstResult: { user_id: 99 },
    });

    const res = await app.request(
      "/api/wallets",
      {
        headers: { Authorization: "Bearer testtoken123" },
      },
      { DB: mockDB }
    );

    expect(res.status).toBe(200);
    expect(mockDB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE api_tokens")
    );
  });
});
