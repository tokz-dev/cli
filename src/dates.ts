import type { DailyStat } from "./types.js";

// Day grouping is UTC by default; setTimezone("local"|IANA) re-buckets. Call
// once at CLI startup, before parsing.
let zone: string | undefined;
let formatter: Intl.DateTimeFormat | undefined;

export function setTimezone(tz?: string): void {
  zone = tz === "utc" || tz === undefined ? undefined : tz;
  formatter = zone
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: zone === "local" ? undefined : zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : undefined;
}

/** YYYY-MM-DD of a timestamp in the configured timezone. */
export function dayKey(ts: string | number): string {
  if (!formatter) return typeof ts === "string" ? ts.slice(0, 10) : new Date(ts).toISOString().slice(0, 10);
  // en-CA formats as YYYY-MM-DD
  return formatter.format(typeof ts === "string" ? new Date(ts) : ts);
}

/** Monday of the ISO week containing a YYYY-MM-DD date. */
export function weekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function monthKey(day: string): string {
  return day.slice(0, 7);
}

export type Grouping = "day" | "week" | "month";

/** Roll daily stats up into weeks (keyed by week-start Monday) or months (YYYY-MM). */
export function groupDaily(daily: DailyStat[], unit: Grouping): DailyStat[] {
  if (unit === "day") return daily;
  const keyOf = unit === "week" ? weekKey : monthKey;
  const out = new Map<string, DailyStat>();
  for (const d of daily) {
    const key = keyOf(d.date);
    const acc =
      out.get(key) ??
      ({ date: key, costUsd: 0, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 0 } satisfies DailyStat);
    acc.costUsd += d.costUsd;
    acc.inputTokens += d.inputTokens;
    acc.cacheReadTokens += d.cacheReadTokens;
    acc.cacheCreationTokens += d.cacheCreationTokens;
    acc.outputTokens += d.outputTokens;
    acc.turns += d.turns;
    out.set(key, acc);
  }
  return [...out.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Accepts YYYY-MM-DD or YYYYMMDD; returns YYYY-MM-DD or undefined. */
export function parseDateArg(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}
