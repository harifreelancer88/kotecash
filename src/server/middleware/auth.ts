import { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

type Bindings = {
  DB: D1Database;
};

type Variables = {
  userId: number;
};

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const authMiddleware: MiddlewareHandler<{
  Bindings: Bindings;
  Variables: Variables;
}> = async (c, next) => {
  // 1. Bearer Token Check
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const tokenHash = await sha256(token);

    try {
      const dbToken = await c.env.DB.prepare(
        "SELECT user_id FROM api_tokens WHERE token_hash = ?"
      )
        .bind(tokenHash)
        .first<{ user_id: number }>();

      if (dbToken) {
        // Update last_used_at
        const now = new Date().toISOString();
        await c.env.DB.prepare(
          "UPDATE api_tokens SET last_used_at = ? WHERE token_hash = ?"
        )
          .bind(now, tokenHash)
          .run();

        c.set("userId", dbToken.user_id);
        return await next();
      }
    } catch (e) {
      console.error("Token database query failed:", e);
    }
  }

  // 2. Cookie Session Check
  const session = getCookie(c, "session");
  if (session) {
    const userId = parseInt(session, 10);
    if (!isNaN(userId)) {
      try {
        const user = await c.env.DB.prepare(
          "SELECT id FROM users WHERE id = ?"
        )
          .bind(userId)
          .first();

        if (user) {
          c.set("userId", userId);
          return await next();
        }
      } catch (e) {
        console.error("Session database query failed:", e);
      }

      // Local dev fallback if DB is not seeded yet
      if (userId === 1) {
        c.set("userId", 1);
        return await next();
      }
    }
  }

  return c.json({ error: "Unauthorized" }, 401);
};
