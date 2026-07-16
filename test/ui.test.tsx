import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { BarChart } from "../src/ui/BarChart.js";
import { Dashboard } from "../src/ui/Dashboard.js";
import { sparkline } from "../src/ui/Sparkline.js";
import type { ProjectAudit } from "../src/projects.js";
import { mkReport } from "./fixtures.js";

const project: ProjectAudit = {
  id: "-home-me-proj",
  name: "/home/me/proj",
  realPath: "/home/me/proj",
  report: mkReport({
    sessionCount: 2,
    spanDays: 10,
    spanStart: "2026-07-01",
    spanEnd: "2026-07-10",
    usageByModel: { "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 9_000_000, cacheCreationTokens: 0, outputTokens: 500_000, turns: 5 } },
    costByModel: { "claude-opus-4-8": { input: 5, cacheRead: 4.5, cacheWrite: 0, output: 12.5, total: 22 } },
    totalCostUsd: 22,
    monthlyProjectionUsd: 66,
    toolCalls: { Read: 30, Bash: 12, mcp__ctx__q: 3 },
    servers: [{ name: "ctx", source: "x", callsObserved: 3, unused: false }, { name: "dead", source: "y", callsObserved: 0, unused: true }],
    daily: [
      { date: "2026-07-01", costUsd: 10, inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1, turns: 2 },
      { date: "2026-07-10", costUsd: 12, inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1, turns: 3 },
    ],
    sessions: [
      { file: "a.jsonl", start: "2026-07-01T10:00:00Z", end: "2026-07-01T12:30:00Z", costUsd: 22, turns: 5, toolCallCount: 45, models: ["claude-opus-4-8"] },
    ],
    cacheSavingsUsd: 40.5,
    cacheHitRate: 0.9,
    totalTurns: 5,
  }),
};

describe("sparkline", () => {
  it("scales values into block characters", () => {
    const s = sparkline([0, 1, 2, 4]);
    expect(s).toHaveLength(4);
    expect(s[0]).toBe("▁");
    expect(s[3]).toBe("█");
  });
});

describe("BarChart", () => {
  it("renders one bar row per entry with display text", () => {
    const { lastFrame } = render(<BarChart rows={[{ label: "opus", value: 10, display: "$10" }]} />);
    expect(lastFrame()).toContain("opus");
    expect(lastFrame()).toContain("█");
    expect(lastFrame()).toContain("$10");
  });

  it("shows percentage share when enabled", () => {
    const { lastFrame } = render(
      <BarChart rows={[{ label: "a", value: 75 }, { label: "b", value: 25 }]} showShare />,
    );
    expect(lastFrame()).toContain("75%");
    expect(lastFrame()).toContain("25%");
  });
});

describe("Dashboard", () => {
  it("shows overview stat cards with cost, cache hit rate and savings", () => {
    const { lastFrame } = render(<Dashboard project={project} />);
    expect(lastFrame()).toContain("/home/me/proj");
    expect(lastFrame()).toContain("$22.00");
    expect(lastFrame()).toContain("90.0%");
    expect(lastFrame()).toContain("$40.50");
    expect(lastFrame()).toContain("never called");
  });

  it("renders the Models tab with token columns", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={1} />);
    expect(lastFrame()).toContain("opus-4-8");
    expect(lastFrame()).toContain("1.0M");
    expect(lastFrame()).toContain("9.0M");
  });

  it("renders the Tools tab with call counts", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={2} />);
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("30");
    expect(lastFrame()).toContain("MCP");
  });

  it("renders the Servers tab and flags UNUSED", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={3} />);
    expect(lastFrame()).toContain("ctx");
    expect(lastFrame()).toContain("UNUSED");
  });

  it("renders the Sessions tab with duration and cost", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={4} />);
    expect(lastFrame()).toContain("2h 30m");
    expect(lastFrame()).toContain("$22.00");
  });

  it("renders the Activity tab with daily costs", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={5} />);
    expect(lastFrame()).toContain("2026-07-10");
    expect(lastFrame()).toContain("active days");
  });
});
