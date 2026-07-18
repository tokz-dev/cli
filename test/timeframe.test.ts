import { describe, it, expect } from "vitest";
import { nextTimeframe, timeframeRange } from "../src/timeframe.js";
import { buildReport, clampSession } from "../src/attribute.js";
import type { SessionStats } from "../src/types.js";

const NOW = Date.parse("2026-07-16T12:00:00Z");

const usage = (inputTokens: number) => ({
  "claude-opus-4-8": { inputTokens, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 1 },
});

const session: SessionStats = {
  file: "a.jsonl",
  firstTs: "2026-07-10T08:00:00Z",
  lastTs: "2026-07-16T10:00:00Z",
  usageByModel: usage(3_000_000),
  toolCalls: { Read: 9 },
  toolCostUsd: { Read: 15 },
  dailyUsage: {
    "2026-07-10": usage(1_000_000),
    "2026-07-15": usage(1_000_000),
    "2026-07-16": usage(1_000_000),
  },
};

describe("timeframeRange", () => {
  it("computes inclusive UTC date ranges", () => {
    expect(timeframeRange("today", NOW)).toEqual({ from: "2026-07-16", to: "2026-07-16" });
    expect(timeframeRange("yesterday", NOW)).toEqual({ from: "2026-07-15", to: "2026-07-15" });
    expect(timeframeRange("7d", NOW)).toEqual({ from: "2026-07-10", to: "2026-07-16" });
  });
});

describe("clampSession", () => {
  it("keeps only in-range days and rebuilds usage", () => {
    const clamped = clampSession(session, "2026-07-15", "2026-07-16")!;
    expect(clamped.usageByModel["claude-opus-4-8"].inputTokens).toBe(2_000_000);
    expect(Object.keys(clamped.dailyUsage)).toEqual(["2026-07-15", "2026-07-16"]);
    expect(clamped.firstTs).toBe("2026-07-15T00:00:00Z"); // clamped to range start
    expect(clamped.lastTs).toBe("2026-07-16T10:00:00Z"); // real end inside range
  });

  it("returns null when nothing falls in range", () => {
    expect(clampSession(session, "2026-01-01", "2026-01-02")).toBeNull();
  });
});

describe("buildReport with range", () => {
  it("filters sessions and prices only in-range usage", () => {
    const report = buildReport([session], [], { from: "2026-07-16", to: "2026-07-16" });
    expect(report.totalCostUsd).toBeCloseTo(5); // 1M opus input
    expect(report.sessionCount).toBe(1);
    expect(report.daily).toHaveLength(1);
  });

  it("drops sessions entirely outside the range", () => {
    const report = buildReport([session], [], { from: "2026-01-01", to: "2026-01-02" });
    expect(report.sessionCount).toBe(0);
    expect(report.totalCostUsd).toBe(0);
  });
});
