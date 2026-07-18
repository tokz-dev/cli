import { dayKey } from "./dates.js";

export const TIMEFRAMES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export interface DateRange {
  from: string; // inclusive YYYY-MM-DD in the configured timezone (UTC by default)
  to: string; // inclusive date
}

const isoDay = (offsetDays: number, now: number) => dayKey(now - offsetDays * 86_400_000);

export function timeframeLabel(id: TimeframeId): string {
  return TIMEFRAMES.find((t) => t.id === id)?.label ?? id;
}

export function nextTimeframe(id: TimeframeId): TimeframeId {
  const i = TIMEFRAMES.findIndex((t) => t.id === id);
  return TIMEFRAMES[(i + 1) % TIMEFRAMES.length].id;
}

/** undefined = no filtering (all time) */
export function timeframeRange(id: TimeframeId, now: number = Date.now()): DateRange | undefined {
  switch (id) {
    case "today":
      return { from: isoDay(0, now), to: isoDay(0, now) };
    case "yesterday":
      return { from: isoDay(1, now), to: isoDay(1, now) };
    case "7d":
      return { from: isoDay(6, now), to: isoDay(0, now) };
    case "30d":
      return { from: isoDay(29, now), to: isoDay(0, now) };
  }
}
