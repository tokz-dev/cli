import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjects } from "../src/projects.js";

function assistantLine(model: string, output: number, msgId: string, tool?: string) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T00:00:00Z",
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
    expect(projects[1].name).toBe("-home-me-small"); // no config match -> id
    expect(projects[1].report.servers).toEqual([]);
  });

  it("returns empty array when projects dir is missing", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-lp-empty-"));
    expect(await loadProjects(home)).toEqual([]);
  });
});
