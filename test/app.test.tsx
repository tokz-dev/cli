import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/ui/App.js";
import type { ProjectAudit } from "../src/projects.js";
import { mkReport } from "./fixtures.js";

// usage priced so aggregate() reproduces `cost`: opus-4-8 input is $5/MTok
const mk = (name: string, cost: number): ProjectAudit => ({
  id: name,
  name,
  label: name.split("/").filter(Boolean).at(-1) ?? name,
  report: mkReport({
    totalCostUsd: cost,
    monthlyProjectionUsd: cost,
    usageByModel: {
      "claude-opus-4-8": { inputTokens: cost * 200_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 1 },
    },
  }),
});

describe("App", () => {
  it("shows the landing menu with buttons by default", () => {
    const { lastFrame } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} />);
    expect(lastFrame()).toContain("Projects");
    expect(lastFrame()).toContain("Browse projects");
    expect(lastFrame()).toContain("Quit");
    expect(lastFrame()).toContain("$6.00"); // aggregated total
  });

  it("lists projects by short name with a pinned All-projects row", () => {
    const { lastFrame } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} initialView="list" />);
    expect(lastFrame()).toContain("proj-a");
    expect(lastFrame()).toContain("All projects");
  });

  it("shows a project dashboard in the project view", () => {
    const { lastFrame } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} initialView="project" initialSelected={0} />);
    expect(lastFrame()).toContain("/proj-a");
    expect(lastFrame()).toContain("API-equivalent");
  });

  it("shows an aggregate dashboard in the aggregate view", () => {
    const { lastFrame } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} initialView="aggregate" />);
    expect(lastFrame()).toContain("All projects");
    expect(lastFrame()).toContain("API-equivalent");
  });

  it("shows a message when there are no projects", () => {
    const { lastFrame } = render(<App projects={[]} />);
    expect(lastFrame()).toContain("No Claude Code transcripts");
  });

  it("opens the help overlay on ?", async () => {
    const { lastFrame, stdin } = render(<App projects={[mk("/proj-a", 5)]} />);
    await new Promise((r) => setTimeout(r, 50)); // let input hooks mount
    stdin.write("?");
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain("Keyboard shortcuts");
  });
});
