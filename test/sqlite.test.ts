import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTable } from "../src/sqlite.js";
import { loadKiloProjects } from "../src/agents/kilo.js";

const FIXTURE = fileURLToPath(new URL("./fixtures/kilo.db", import.meta.url));

describe("readTable (pure-JS SQLite reader)", () => {
  it("reads rows by column name and reassembles overflow payloads", async () => {
    const rows = await readTable(FIXTURE, "message");
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0])).toContain("data");
    const m2 = rows.find((r) => r.id === "m2")!;
    // the 6000-char pad forces the record onto overflow pages
    expect(JSON.parse(String(m2.data)).pad).toHaveLength(6000);
  });

  it("returns [] for a missing or non-SQLite file", async () => {
    expect(await readTable(join(tmpdir(), "nope.db"), "message")).toEqual([]);
  });
});

describe("kilo adapter", () => {
  it("parses assistant token usage from the message table", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-kilo-"));
    const dir = join(home, ".local", "share", "kilo");
    mkdirSync(dir, { recursive: true });
    cpSync(FIXTURE, join(dir, "kilo.db"));

    const projects = await loadKiloProjects(home);
    expect(projects).toHaveLength(1);
    const u = projects[0].report.usageByModel["claude-sonnet-4-6"];
    expect(u.turns).toBe(2); // two assistant messages, user row skipped
    expect(u.inputTokens).toBe(200); // 2 x 100
    expect(u.outputTokens).toBe(60); // (20+5) + (30+5)
    expect(u.cacheReadTokens).toBe(100); // 2 x 50
    expect(u.cacheCreationTokens).toBe(20); // 2 x 10
  });
});
