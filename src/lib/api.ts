export const API_BASE =
  (import.meta as any).env?.PUBLIC_API_BASE || "";

export async function api<T = any>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function fmt(n: number): string {
  return Number(n || 0).toLocaleString("id-ID");
}

export function rp(n: number): string {
  return "Rp" + fmt(n);
}

export function pct(n: number): string {
  return (Number(n || 0) * 100).toFixed(1) + "%";
}

// Tier colors
export const tierColor = (tier: string): string => {
  if (tier === "green") return "var(--c-success)";
  if (tier === "amber") return "var(--c-warning)";
  if (tier === "red") return "var(--c-danger)";
  return "var(--c-focus)";
};
