import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregate, loadProjects, type ProjectAudit } from "../src/projects.js";
import { buildReport } from "../src/attribute.js";
import { findAdapter } from "../src/agents/index.js";
import type { SessionStats } from "../src/types.js";

function assistantLine(model: string, output: number, msgId: string, tool?: string, cwd?: string) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T00:00:00Z",
    cwd,
    message: {
      id: msgId,
      model,
      usage: { input_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output },
      content: tool ? [{ type: "tool_use", id: "toolu_" + msgId, name: tool }] : [],
    },
  });
}

describe("loadProjects", () => {
  it("groups per project dir, resolves real path + servers, sorts by cost", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-lp-"));
    const realPath = "/home/me/big";
    const sanBig = realPath.replace(/[^a-zA-Z0-9]/g, "-"); // -home-me-big
    const bigDir = join(home, ".claude", "projects", sanBig);
    const smallDir = join(home, ".claude", "projects", "-home-me-small");
    mkdirSync(bigDir, { recursive: true });
    mkdirSync(smallDir, { recursive: true });
    writeFileSync(join(bigDir, "s.jsonl"), assistantLine("claude-opus-4-8", 1_000_000, "msg_big", "mcp__ctx__q"));
    writeFileSync(join(smallDir, "s.jsonl"), assistantLine("claude-opus-4-8", 10, "msg_small"));
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ projects: { [realPath]: { mcpServers: { ctx: { command: "npx" } } } } }),
    );

    const projects = await loadProjects(home);
    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe(sanBig); // highest cost first
    expect(projects[0].name).toBe(realPath); // real path resolved
    expect(projects[0].report.servers.map((s) => s.name)).toEqual(["ctx"]);
    expect(projects[0].report.servers[0].unused).toBe(false); // ctx was called
    expect(projects[0].label).toBe("big"); // basename for display
    expect(projects[1].name).toBe("-home-me-small"); // no config match, no cwd -> id
    expect(projects[1].label).toBe("-home-me-small");
    expect(projects[1].report.servers).toEqual([]);
  });

  it("falls back to the transcript cwd for the real path when config has no entry", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-lp-cwd-"));
    const dir = join(home, ".claude", "projects", "-home-me-app");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s.jsonl"), assistantLine("claude-opus-4-8", 10, "msg_1", undefined, "/home/me/app"));

    const projects = await loadProjects(home);
    expect(projects[0].name).toBe("/home/me/app");
    expect(projects[0].label).toBe("app");
  });

  it("returns empty array when projects dir is missing", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-lp-empty-"));
    expect(await loadProjects(home)).toEqual([]);
  });
});

describe("aggregate", () => {
  // The TUI aggregates per-project reports while `tokz audit` builds one report
  // from the same sessions; both must land on the same span and projection.
  it("matches buildReport's spanDays for the same sessions", () => {
    const usage = (turns: number) => ({
      "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns },
    });
    // 6 days and 18 hours apart: rounds to 7 from timestamps, 6 from dates alone.
    const sessions: SessionStats[] = [
      {
        file: "a.jsonl",
        firstTs: "2026-07-01T00:00:00Z",
        lastTs: "2026-07-01T00:00:00Z",
        usageByModel: usage(1),
        toolCalls: {},
        toolCostUsd: {},
        dailyUsage: { "2026-07-01": usage(1) },
      },
      {
        file: "b.jsonl",
        firstTs: "2026-07-07T18:00:00Z",
        lastTs: "2026-07-07T18:00:00Z",
        usageByModel: usage(1),
        toolCalls: {},
        toolCostUsd: {},
        dailyUsage: { "2026-07-07": usage(1) },
      },
    ];
    const single = buildReport(sessions, []);
    const perProject: ProjectAudit[] = sessions.map((s, i) => ({
      id: `p${i}`,
      name: `p${i}`,
      label: `p${i}`,
      report: buildReport([s], []),
      sessions: [s],
      serverList: [],
    }));
    const merged = aggregate(perProject);

    expect(single.spanDays).toBe(7);
    expect(merged.spanDays).toBe(single.spanDays);
    expect(merged.monthlyProjectionUsd).toBeCloseTo(single.monthlyProjectionUsd);
    expect(merged.totalCostUsd).toBeCloseTo(single.totalCostUsd);
  });
});

describe("findAdapter", () => {
  it("resolves an audit target by agent id or display name, case-insensitively", () => {
    expect(findAdapter("codex")?.id).toBe("codex");
    expect(findAdapter(" Codex ")?.id).toBe("codex");
    expect(findAdapter("Claude Code")?.id).toBe("claude");
    expect(findAdapter("./some/project")).toBeUndefined();
  });
});
