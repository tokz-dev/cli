import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { BarChart } from "../src/ui/BarChart.js";
import { Dashboard } from "../src/ui/Dashboard.js";
import type { ProjectAudit } from "../src/projects.js";

const project: ProjectAudit = {
  id: "-home-me-proj",
  name: "/home/me/proj",
  realPath: "/home/me/proj",
  report: {
    sessionCount: 2,
    spanDays: 10,
    usageByModel: { "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 500_000, turns: 5 } },
    costByModel: { "claude-opus-4-8": { input: 5, cacheRead: 0, cacheWrite: 0, output: 12.5, total: 17.5 } },
    totalCostUsd: 17.5,
    monthlyProjectionUsd: 52.5,
    toolCalls: { Read: 30, Bash: 12 },
    servers: [{ name: "ctx", source: "x", callsObserved: 0, unused: true }],
  },
};

describe("BarChart", () => {
  it("renders one bar row per entry with display text", () => {
    const { lastFrame } = render(<BarChart rows={[{ label: "opus", value: 10, display: "$10" }]} />);
    expect(lastFrame()).toContain("opus");
    expect(lastFrame()).toContain("█");
    expect(lastFrame()).toContain("$10");
  });
});

describe("Dashboard", () => {
  it("shows header, cost, and overview by default", () => {
    const { lastFrame } = render(<Dashboard project={project} />);
    expect(lastFrame()).toContain("/home/me/proj");
    expect(lastFrame()).toContain("$17.50");
    expect(lastFrame()).toContain("claude-opus-4-8");
  });

  it("renders the Servers tab and flags UNUSED", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={3} />);
    expect(lastFrame()).toContain("ctx");
    expect(lastFrame()).toContain("UNUSED");
  });

  it("renders the Tools tab with call counts", () => {
    const { lastFrame } = render(<Dashboard project={project} initialTab={2} />);
    expect(lastFrame()).toContain("Read");
    expect(lastFrame()).toContain("30");
  });
});
