export const TIMEFRAMES = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export interface DateRange {
  from: string; // inclusive ISO date (YYYY-MM-DD, UTC — matches transcript timestamps)
  to: string; // inclusive ISO date
}

const isoDay = (offsetDays: number, now: number) =>
  new Date(now - offsetDays * 86_400_000).toISOString().slice(0, 10);

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
    case "all":
      return undefined;
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
