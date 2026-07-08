import { Hono } from "hono";
import type { AppContext, Bindings, Variables } from "../types";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export type Freq = "monthly" | "yearly" | "weekly" | "daily";

export interface RecurSpec {
  frequency: Freq;
  day_of_month: number | null;
  month_of_year: number | null;
  weekday: number | null;
}

/** Compute the next run date AFTER `afterDate` ('YYYY-MM-DD'). Pure. */
export function advanceNextRun(spec: RecurSpec, afterDate: string): string {
  const [y, m, d] = afterDate.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  if (spec.frequency === "monthly") {
    const dom = spec.day_of_month ?? 1;
    const next = new Date(Date.UTC(y, m, 1)); // next month
    next.setUTCDate(Math.min(dom, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
    return toISO(next);
  }
  if (spec.frequency === "yearly") {
    const mm = (spec.month_of_year ?? 1) - 1;
    const dom = spec.day_of_month ?? 1;
    const next = new Date(Date.UTC(y + 1, mm, 1));
    next.setUTCDate(Math.min(dom, daysInMonth(next.getUTCFullYear(), next.getUTCMonth())));
    return toISO(next);
  }
  if (spec.frequency === "weekly") {
    base.setUTCDate(base.getUTCDate() + 7);
    return toISO(base);
  }
  // daily
  base.setUTCDate(base.getUTCDate() + 1);
  return toISO(base);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

app.get("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const res = await c.env.DB.prepare(
    "SELECT * FROM recurring_templates WHERE user_id=? ORDER BY id"
  ).bind(uid).all();
  return c.json(res.results);
});

app.post("/", async (c: AppContext) => {
  const uid = c.get("userId");
  const b = await c.req.json();
  if (!b.amount || b.amount <= 0) return c.json({ error: "Amount must be positive" }, 400);
  if (!b.frequency) return c.json({ error: "frequency required" }, 400);
  const firstRun = b.next_run ?? todayISO();
  const res = await c.env.DB.prepare(
    `INSERT INTO recurring_templates (user_id, frequency, day_of_month, month_of_year, weekday, amount, description, category_id, src_kind, src_id, dst_kind, dst_id, next_run, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(uid, b.frequency, b.day_of_month ?? null, b.month_of_year ?? null, b.weekday ?? null,
         b.amount, b.description ?? null, b.category_id ?? null,
         b.src_kind ?? null, b.src_id ?? null, b.dst_kind ?? null, b.dst_id ?? null, firstRun).run();
  return c.json({ id: res.meta.last_row_id }, 201);
});

app.delete("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  await c.env.DB.prepare("DELETE FROM recurring_templates WHERE id=? AND user_id=?")
    .bind(c.req.param("id"), uid).run();
  return c.json({ success: true });
});

app.put("/:id", async (c: AppContext) => {
  const uid = c.get("userId");
  const id = c.req.param("id");
  const b = await c.req.json();
  // Partial update: only touch provided fields. `active` toggles pause/resume.
  const sets: string[] = [];
  const args: any[] = [];
  for (const k of ["description", "amount", "frequency", "day_of_month", "month_of_year",
                   "weekday", "category_id", "src_kind", "src_id", "dst_kind", "dst_id", "next_run"]) {
    if (b[k] !== undefined) { sets.push(k + "=?"); args.push(b[k]); }
  }
  if (b.active !== undefined) { sets.push("active=?"); args.push(b.active ? 1 : 0); }
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);
  args.push(id, uid);
  await c.env.DB.prepare(
    `UPDATE recurring_templates SET ${sets.join(", ")} WHERE id=? AND user_id=?`
  ).bind(...args).run();
  return c.json({ success: true });
});

/** Materialize every due template into a movement and roll next_run forward.
 *  Called by the dashboard sweep. Returns the count emitted. */
app.post("/sweep", async (c: AppContext) => {
  const uid = c.get("userId");
  const today = todayISO();
  const due = await c.env.DB.prepare(
    "SELECT * FROM recurring_templates WHERE user_id=? AND active=1 AND next_run <= ?"
  ).bind(uid, today).all<any>();

  let emitted = 0;
  for (const t of due.results) {
    await c.env.DB.prepare(
      `INSERT INTO movements (user_id, date, amount, description, category_id, src_kind, src_id, dst_kind, dst_id, recurring_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(uid, t.next_run, t.amount, t.description, t.category_id,
           t.src_kind, t.src_id, t.dst_kind, t.dst_id, t.id).run();
    const spec: RecurSpec = { frequency: t.frequency, day_of_month: t.day_of_month,
      month_of_year: t.month_of_year, weekday: t.weekday };
    await c.env.DB.prepare("UPDATE recurring_templates SET next_run=? WHERE id=?")
      .bind(advanceNextRun(spec, t.next_run), t.id).run();
    emitted++;
  }
  return c.json({ emitted });
});

export default app;
