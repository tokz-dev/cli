import { describe, it, expect } from "vitest";
import { buildReport } from "../src/attribute.js";
import type { SessionStats } from "../src/types.js";

const session: SessionStats = {
  file: "a.jsonl",
  firstTs: "2026-07-01T00:00:00Z",
  lastTs: "2026-07-11T00:00:00Z",
  usageByModel: {
    "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 5 },
  },
  toolCalls: { "mcp__context7__query-docs": 3, Read: 10 },
};

describe("buildReport", () => {
  it("flags unused servers, sums cost, projects monthly", () => {
    const report = buildReport([session], [
      { name: "context7", source: "x" },
      { name: "craftspace", source: "y" },
    ]);

    expect(report.sessionCount).toBe(1);
    expect(report.totalCostUsd).toBeCloseTo(5); // 1M input on opus-4-8
    expect(report.spanDays).toBe(10);
    expect(report.monthlyProjectionUsd).toBeCloseTo(15); // 5 / 10 * 30

    const context7 = report.servers.find((s) => s.name === "context7")!;
    const craftspace = report.servers.find((s) => s.name === "craftspace")!;
    expect(context7.callsObserved).toBe(3);
    expect(context7.unused).toBe(false);
    expect(craftspace.callsObserved).toBe(0);
    expect(craftspace.unused).toBe(true);

    expect(report.spanStart).toBe("2026-07-01");
    expect(report.spanEnd).toBe("2026-07-11");
  });
});
