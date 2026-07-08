import type { Context } from "hono";

export type Bindings = {
  DB: D1Database;
};

export type Variables = {
  userId: number;
};

export type AppContext = Context<
  { Bindings: Bindings; Variables: Variables }
>;

export function userId(c: AppContext): number {
  return c.get("userId");
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
