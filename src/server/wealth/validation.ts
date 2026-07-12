export function isEnumValue<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

export function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

export function requiredText(value: unknown): string | null {
  const text = optionalText(value);
  return text && text.length > 0 ? text : null;
}

export function normalizeCurrency(value: unknown, fallback = "INR"): string | null {
  const raw = value == null || value === "" ? fallback : String(value).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : null;
}

export function parseQueryBoolean(value: string | null): boolean | undefined | null {
  if (value == null || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function isDateOnly(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeIdentifier(value: unknown): string | null {
  const text = optionalText(value);
  return text ? text.toUpperCase() : null;
}
