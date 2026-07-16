export const usd = (n: number): string => `$${n.toFixed(2)}`;
export const tok = (n: number): string => n.toLocaleString("en-US");

/** 1234 -> "1.2k", 5_600_000 -> "5.6M", 42 -> "42" */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** One-decimal percentage, so a 99.9% cache hit rate doesn't display as 100%. */
export const pct1 = (fraction: number): string => `${(fraction * 100).toFixed(1)}%`;

/** "claude-opus-4-8" -> "opus-4-8", "claude-haiku-4-5-20251001" -> "haiku-4-5" */
export const shortModel = (id: string): string =>
  id.replace(/^claude-/, "").replace(/-\d{8}$/, "");

/** Duration between two ISO timestamps: "3h 12m", "45m", "2m", "<1m". */
export function duration(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return "—";
  const mins = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** ISO date/timestamp -> "today", "yesterday", "3d ago", "2026-05-01". */
export function relativeDate(iso?: string, now: number = Date.now()): string {
  if (!iso) return "—";
  const date = iso.slice(0, 10);
  const days = Math.floor((now - Date.parse(date)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return date;
}
