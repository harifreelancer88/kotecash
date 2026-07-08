import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (
    "kote_" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT id, label, prefix, created_at, last_used_at FROM api_tokens WHERE user_id=? ORDER BY id DESC"
  )
    .bind(uid)
    .all();
  return c.json(res.results);
});

app.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const body = await c.req.json();
  if (!body.label) return c.json({ error: "Label required" }, 400);
  const token = randomToken();
  const tokenHash = await sha256(token);
  const prefix = token.slice(0, 10) + "...";
  const res = await c.env.DB.prepare(
    "INSERT INTO api_tokens (user_id, label, token_hash, prefix) VALUES (?, ?, ?, ?)"
  )
    .bind(uid, body.label, tokenHash, prefix)
    .run();
  return c.json({ id: res.meta.last_row_id, token, prefix }, 201);
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM api_tokens WHERE id=? AND user_id=?")
    .bind(id, uid)
    .run();
  return c.json({ success: true });
});

export default app;
