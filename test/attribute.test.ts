import { describe, it, expect } from "vitest";
import { buildReport } from "../src/attribute.js";
import type { SessionStats } from "../src/types.js";

const opusDay = (inputTokens: number, cacheReadTokens = 0) => ({
  "claude-opus-4-8": { inputTokens, cacheReadTokens, cacheCreationTokens: 0, outputTokens: 0, turns: 5 },
});

const session: SessionStats = {
  file: "a.jsonl",
  firstTs: "2026-07-01T00:00:00Z",
  lastTs: "2026-07-11T00:00:00Z",
  usageByModel: opusDay(1_000_000, 2_000_000),
  toolCalls: { "mcp__context7__query-docs": 3, Read: 10 },
  dailyUsage: {
    "2026-07-01": opusDay(400_000, 1_000_000),
    "2026-07-11": opusDay(600_000, 1_000_000),
  },
};

describe("buildReport", () => {
  it("flags unused servers, sums cost, projects monthly", () => {
    const report = buildReport([session], [
      { name: "context7", source: "x" },
      { name: "craftspace", source: "y" },
    ]);

    expect(report.sessionCount).toBe(1);
    expect(report.totalCostUsd).toBeCloseTo(6); // 1M input + 2M cache read @0.1x on opus-4-8
    expect(report.spanDays).toBe(10);
    expect(report.monthlyProjectionUsd).toBeCloseTo(18); // 6 / 10 * 30

    const context7 = report.servers.find((s) => s.name === "context7")!;
    const craftspace = report.servers.find((s) => s.name === "craftspace")!;
    expect(context7.callsObserved).toBe(3);
    expect(context7.unused).toBe(false);
    expect(craftspace.callsObserved).toBe(0);
    expect(craftspace.unused).toBe(true);

    expect(report.spanStart).toBe("2026-07-01");
    expect(report.spanEnd).toBe("2026-07-11");
  });

  it("builds daily stats sorted ascending", () => {
    const report = buildReport([session], []);
    expect(report.daily.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-11"]);
    expect(report.daily[0].costUsd).toBeCloseTo(0.4 * 5 + 1 * 0.5); // 400k input + 1M cache read
    expect(report.daily[0].turns).toBe(5);
  });

  it("computes cache hit rate and savings", () => {
    const report = buildReport([session], []);
    expect(report.cacheHitRate).toBeCloseTo(2 / 3); // 2M cache read vs 1M input
    expect(report.cacheSavingsUsd).toBeCloseTo(2 * 5 * 0.9); // 2M @ $5/M, 90% saved
    expect(report.totalTurns).toBe(5);
  });

  it("summarizes sessions sorted by cost", () => {
    const cheap: SessionStats = {
      file: "b.jsonl",
      firstTs: "2026-07-02T00:00:00Z",
      lastTs: "2026-07-02T01:00:00Z",
      usageByModel: opusDay(100_000),
      toolCalls: { Read: 2 },
      dailyUsage: {},
    };
    const report = buildReport([cheap, session], []);
    expect(report.sessions.map((s) => s.file)).toEqual(["a.jsonl", "b.jsonl"]);
    expect(report.sessions[0].models).toEqual(["claude-opus-4-8"]);
    expect(report.sessions[0].toolCallCount).toBe(13);
    expect(report.sessions[1].costUsd).toBeCloseTo(0.5);
  });
});
