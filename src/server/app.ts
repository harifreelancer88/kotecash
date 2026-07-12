import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { authMiddleware } from "./middleware/auth";
import type { Bindings, Variables } from "./types";
import dashboard from "./routes/dashboard";
import transactions from "./routes/transactions";
import movements from "./routes/movements";
import recurring from "./routes/recurring";
import wallets from "./routes/wallets";
import goals from "./routes/goals";
import cicilan from "./routes/cicilan";
import tokens from "./routes/tokens";
import networth from "./routes/networth";
import { creditCards, deposits, portfolios } from "./routes/misc";
import { categories, budgets, earmarks } from "./routes/manage";
import wealthAccounts from "./routes/wealth-accounts";
import wealthAssets from "./routes/wealth-assets";

type AppEnv = { Bindings: Bindings; Variables: Variables };

const app = new Hono<AppEnv>();

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Auth (public) ──────────────────────────────────────────────
app.post("/api/auth/login", async (c) => {
  try {
    const { email, password } = await c.req.json();
    if (!email || !password)
      return c.json({ error: "Email and password required" }, 400);

    let user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: number; email: string; password_hash: string }>();

    // Auto-seed admin on first run
    if (!user) {
      const countRes = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM users"
      ).first<{ count: number }>();
      if (countRes && countRes.count === 0) {
        await c.env.DB.prepare(
          "INSERT INTO users (email, password_hash) VALUES (?, ?)"
        )
          .bind("admin@example.com", await sha256("admin"))
          .run();
        user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?")
          .bind("admin@example.com")
          .first<{ id: number; email: string; password_hash: string }>();
      }
    }

    if (user && user.password_hash === (await sha256(password))) {
      setCookie(c, "session", user.id.toString(), {
        path: "/",
        httpOnly: true,
        secure: true,
        maxAge: 60 * 60 * 24 * 7,
        sameSite: "Lax",
      });
      return c.json({
        success: true,
        user: { id: user.id, email: user.email },
      });
    }
    return c.json({ error: "Invalid credentials" }, 401);
  } catch (e) {
    console.error("Login error:", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});

// ── Protected routes ───────────────────────────────────────────
app.use("/api/*", authMiddleware);

app.get("/api/auth/me", async (c) => {
  const uid = c.get("userId");
  const user = await c.env.DB.prepare(
    "SELECT id, email, created_at FROM users WHERE id = ?"
  )
    .bind(uid)
    .first();
  if (user) return c.json({ user });
  return c.json({ error: "User not found" }, 404);
});

app.put("/api/account/password", async (c) => {
  const uid = c.get("userId");
  const { password } = await c.req.json();
  if (!password) return c.json({ error: "Password required" }, 400);
  await c.env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?")
    .bind(await sha256(password), uid)
    .run();
  return c.json({ success: true });
});

// ── Mount resource routers ─────────────────────────────────────
app.route("/api", dashboard);
app.route("/api/transactions", transactions);
app.route("/api/movements", movements);
app.route("/api/recurring", recurring);
app.route("/api/wallets", wallets);
app.route("/api/goals", goals);
app.route("/api/cicilan", cicilan);
app.route("/api/tokens", tokens);
app.route("/api/net-worth", networth);
app.route("/api/credit-cards", creditCards);
app.route("/api/deposits", deposits);
app.route("/api/portfolios", portfolios);
app.route("/api/wealth/accounts", wealthAccounts);
app.route("/api/wealth/assets", wealthAssets);
app.route("/api/categories", categories);
app.route("/api/budgets", budgets);
app.route("/api/earmarks", earmarks);

export { app };
export default app;
