import { describe, it, expect, afterEach } from "vitest";
import { dayKey, groupDaily, monthKey, parseDateArg, setTimezone, weekKey } from "../src/dates.js";
import type { DailyStat } from "../src/types.js";

afterEach(() => setTimezone(undefined));

describe("dayKey", () => {
  it("defaults to UTC (ISO prefix)", () => {
    expect(dayKey("2026-07-17T23:30:00.000Z")).toBe("2026-07-17");
  });

  it("re-buckets days in a configured IANA zone", () => {
    setTimezone("Asia/Amman"); // UTC+3
    expect(dayKey("2026-07-17T23:30:00.000Z")).toBe("2026-07-18");
    expect(dayKey("2026-07-17T02:00:00.000Z")).toBe("2026-07-17");
  });
});

describe("week/month keys", () => {
  it("weekKey returns the Monday of the ISO week", () => {
    expect(weekKey("2026-07-17")).toBe("2026-07-13"); // Friday -> Monday
    expect(weekKey("2026-07-13")).toBe("2026-07-13"); // Monday stays
    expect(weekKey("2026-07-19")).toBe("2026-07-13"); // Sunday belongs to same week
  });

  it("monthKey truncates to YYYY-MM", () => {
    expect(monthKey("2026-07-17")).toBe("2026-07");
  });
});

describe("groupDaily", () => {
  const day = (date: string, costUsd: number, turns = 1): DailyStat => ({
    date,
    costUsd,
    inputTokens: 10,
    cacheReadTokens: 20,
    cacheCreationTokens: 5,
    outputTokens: 2,
    turns,
  });

  it("rolls days into weeks and months", () => {
    const daily = [day("2026-07-13", 1), day("2026-07-17", 2), day("2026-07-20", 4), day("2026-08-01", 8)];
    const weeks = groupDaily(daily, "week");
    expect(weeks.map((w) => [w.date, w.costUsd])).toEqual([
      ["2026-07-13", 3],
      ["2026-07-20", 4],
      ["2026-07-27", 8], // Aug 1 2026 is a Saturday in the week of Jul 27
    ]);
    const months = groupDaily(daily, "month");
    expect(months.map((m) => [m.date, m.costUsd, m.turns])).toEqual([
      ["2026-07", 7, 3],
      ["2026-08", 8, 1],
    ]);
    expect(groupDaily(daily, "day")).toBe(daily);
  });
});

describe("parseDateArg", () => {
  it("accepts dashed and bare forms", () => {
    expect(parseDateArg("2026-07-17")).toBe("2026-07-17");
    expect(parseDateArg("20260717")).toBe("2026-07-17");
    expect(parseDateArg("nonsense")).toBeUndefined();
    expect(parseDateArg(undefined)).toBeUndefined();
  });
});
