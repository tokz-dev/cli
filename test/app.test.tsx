import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/ui/App.js";
import type { ProjectAudit } from "../src/projects.js";

const mk = (name: string, cost: number): ProjectAudit => ({
  id: name,
  name,
  report: {
    sessionCount: 1,
    spanDays: 1,
    usageByModel: {},
    costByModel: {},
    totalCostUsd: cost,
    monthlyProjectionUsd: cost,
    toolCalls: {},
    servers: [],
  },
});

describe("App", () => {
  it("lists projects by default", () => {
    const { lastFrame } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} />);
    expect(lastFrame()).toContain("2 projects");
    expect(lastFrame()).toContain("/proj-a");
  });

  it("shows a project dashboard when one is selected", () => {
    const { lastFrame } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} initialSelected={0} />);
    expect(lastFrame()).toContain("/proj-a");
    expect(lastFrame()).toContain("API-equivalent");
  });

  it("shows a message when there are no projects", () => {
    const { lastFrame } = render(<App projects={[]} />);
    expect(lastFrame()).toContain("No Claude Code transcripts");
  });
});
