import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMcpServers } from "../src/mcp.js";

describe("findMcpServers", () => {
  it("merges project .mcp.json and global ~/.claude.json, deduped by name", async () => {
    const proj = mkdtempSync(join(tmpdir(), "tokz-proj-"));
    const home = mkdtempSync(join(tmpdir(), "tokz-home-"));

    writeFileSync(join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { context7: { command: "npx" } } }));
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { context7: { command: "dupe" }, craftspace: { url: "https://x" } },
        projects: { [proj]: { mcpServers: { local: { command: "node" } } } },
      }),
    );

    const servers = await findMcpServers(proj, home);
    const names = servers.map((s) => s.name).sort();
    expect(names).toEqual(["context7", "craftspace", "local"]);
    expect(servers.find((s) => s.name === "context7")!.source.endsWith(".mcp.json")).toBe(true);
  });

  it("returns empty list when no configs exist", async () => {
    const proj = mkdtempSync(join(tmpdir(), "tokz-empty-"));
    const home = mkdtempSync(join(tmpdir(), "tokz-emptyhome-"));
    expect(await findMcpServers(proj, home)).toEqual([]);
  });
});
