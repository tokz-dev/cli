import { describe, it, expect } from "vitest";
import { activityUnits, renderActivity, renderReport } from "../src/report.js";
import type { AuditReport } from "../src/types.js";
import { mkReport } from "./fixtures.js";

const report: AuditReport = mkReport({
  sessionCount: 2,
  spanDays: 10,
  usageByModel: {
    "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 5_000_000, cacheCreationTokens: 100_000, outputTokens: 200_000, turns: 42 },
  },
  costByModel: {
    "claude-opus-4-8": { input: 5, cacheRead: 2.5, cacheWrite: 0.625, output: 5, total: 13.125 },
  },
  totalCostUsd: 13.125,
  monthlyProjectionUsd: 39.375,
  toolCalls: { Read: 30, "mcp__context7__query-docs": 2 },
  servers: [
    { name: "context7", source: "x", callsObserved: 2, unused: false, estCostUsd: 1.2, configured: true },
    { name: "craftspace", source: "y", callsObserved: 0, unused: true, estCostUsd: 0, configured: true },
  ],
});

describe("renderReport", () => {
  it("includes headline cost, unused marker, and tool counts", () => {
    const out = renderReport(report);
    expect(out).toContain("$13.13");
    expect(out).toContain("$39.38/month");
    expect(out).toContain("craftspace");
    expect(out).toContain("UNUSED");
    expect(out).toContain("Read");
  });

  it("totals multi-row tables and skips the total when there's one row", () => {
    const out = renderReport(report);
    expect(out).toContain("TOTAL"); // 2 servers, 2 tools
    expect(out).toContain("32"); // 30 Read + 2 mcp calls
    // Only one model, so the cost table's single row is already the total.
    expect(out.split("TOTAL")).toHaveLength(3);

    const twoModels = renderReport({
      ...report,
      usageByModel: {
        ...report.usageByModel,
        "claude-haiku-4-5": { inputTokens: 500_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 100_000, turns: 8 },
      },
      costByModel: {
        ...report.costByModel,
        "claude-haiku-4-5": { input: 0.5, cacheRead: 0, cacheWrite: 0, output: 0.4, total: 0.9 },
      },
      totalCostUsd: 14.025,
    });
    expect(twoModels).toContain("1,500,000"); // input summed across models
    expect(twoModels).toContain("$14.03"); // total cost row matches the headline
  });

  it("defaults the activity breakdown to day, and honours explicit units", () => {
    expect(activityUnits({})).toEqual(["day"]);
    expect(activityUnits({ weekly: true })).toEqual(["week"]); // replaces the default
    expect(activityUnits({ daily: true, monthly: true })).toEqual(["month", "day"]); // coarse to fine
    expect(activityUnits({ breakdown: "weekly, days" })).toEqual(["week", "day"]);
    expect(activityUnits({ breakdown: "none" })).toEqual([]);
  });

  it("renders a daily activity table with a total row", () => {
    const out = renderActivity(
      [
        { date: "2026-07-01", costUsd: 1.5, inputTokens: 10, cacheReadTokens: 100, cacheCreationTokens: 5, outputTokens: 20, turns: 3 },
        { date: "2026-07-02", costUsd: 2.5, inputTokens: 30, cacheReadTokens: 200, cacheCreationTokens: 5, outputTokens: 40, turns: 4 },
      ],
      "day",
    );
    expect(out).toContain("Activity by day");
    expect(out).toContain("Day");
    expect(out).toContain("$4.00");
    expect(out).toContain("300"); // cache read summed
    expect(out).toContain("7"); // turns summed
  });
});
