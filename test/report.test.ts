import { describe, it, expect } from "vitest";
import { renderReport } from "../src/report.js";
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
    { name: "context7", source: "x", callsObserved: 2, unused: false },
    { name: "craftspace", source: "y", callsObserved: 0, unused: true },
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
});
