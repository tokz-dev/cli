import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS } from "../src/agents/index.js";
import { parseCodexRollout, loadCodexProjects, codexAdapter } from "../src/agents/codex.js";
import { loadOpencodeProjects, opencodeAdapter } from "../src/agents/opencode.js";

function codexLines(): string {
  const tc = (input: number, cached: number, output: number) =>
    JSON.stringify({
      timestamp: "2026-07-10T10:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            reasoning_output_tokens: 0,
            total_tokens: input + output,
          },
        },
      },
    });
  return [
    JSON.stringify({
      timestamp: "2026-07-10T10:00:00.000Z",
      type: "session_meta",
      payload: { id: "s1", cwd: "/home/me/api", cli_version: "0.50.0" },
    }),
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-5-codex", cwd: "/home/me/api" } }),
    JSON.stringify({ type: "response_item", payload: { type: "function_call", name: "shell" } }),
    tc(1_000_000, 400_000, 50_000),
    tc(1_000_000, 400_000, 50_000), // duplicate snapshot -> zero delta, ignored
    tc(1_500_000, 800_000, 80_000),
  ].join("\n");
}

describe("parseCodexRollout", () => {
  it("derives per-turn usage from cumulative token_count deltas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokz-cdx-"));
    const file = join(dir, "rollout-x.jsonl");
    writeFileSync(file, codexLines());

    const s = await parseCodexRollout(file);
    expect(s.cwd).toBe("/home/me/api");
    const u = s.usageByModel["gpt-5-codex"];
    // totals: input 1.5M (cached 800k -> uncached 700k), output 80k; duplicate ignored
    expect(u.inputTokens).toBe(700_000);
    expect(u.cacheReadTokens).toBe(800_000);
    expect(u.outputTokens).toBe(80_000);
    expect(u.turns).toBe(2);
    expect(s.toolCalls.shell).toBe(1);
    expect(s.toolCostUsd.shell).toBeGreaterThan(0);
  });

  it("groups codex sessions into projects by cwd", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-cdxhome-"));
    const day = join(home, ".codex", "sessions", "2026", "07", "10");
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, "rollout-a.jsonl"), codexLines());

    expect(await codexAdapter.detect(home)).toBe(true);
    const projects = await loadCodexProjects(home);
    expect(projects).toHaveLength(1);
    expect(projects[0].label).toBe("api");
    expect(projects[0].report.totalCostUsd).toBeGreaterThan(0);
    expect(projects[0].report.usageByModel["gpt-5-codex"]).toBeDefined();
  });
});

describe("loadOpencodeProjects", () => {
  it("builds per-project reports from message token counts", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-oc-"));
    const storage = join(home, ".local", "share", "opencode", "storage");
    mkdirSync(join(storage, "message", "ses_1"), { recursive: true });
    mkdirSync(join(storage, "session", "proj"), { recursive: true });

    writeFileSync(
      join(storage, "session", "proj", "ses_1.json"),
      JSON.stringify({ id: "ses_1", directory: "/home/me/web", time: { created: 1752600000000 } }),
    );
    writeFileSync(
      join(storage, "message", "ses_1", "msg_1.json"),
      JSON.stringify({
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        modelID: "claude-sonnet-4-6",
        providerID: "anthropic",
        time: { created: 1752600000000 },
        tokens: { input: 1_000_000, output: 100_000, reasoning: 0, cache: { read: 500_000, write: 20_000 } },
      }),
    );
    writeFileSync(
      join(storage, "message", "ses_1", "msg_2.json"),
      JSON.stringify({ id: "msg_2", sessionID: "ses_1", role: "user" }),
    );

    expect(await opencodeAdapter.detect(home)).toBe(true);
    const projects = await loadOpencodeProjects(home);
    expect(projects).toHaveLength(1);
    expect(projects[0].label).toBe("web");
    const u = projects[0].report.usageByModel["claude-sonnet-4-6"];
    expect(u.inputTokens).toBe(1_000_000);
    expect(u.cacheReadTokens).toBe(500_000);
    expect(u.cacheCreationTokens).toBe(20_000);
    expect(u.outputTokens).toBe(100_000);
    // sonnet: $3 input + $0.15 cache read + $0.075 cache write + $1.5 output
    expect(projects[0].report.totalCostUsd).toBeCloseTo(3 + 0.15 + 0.075 + 1.5, 3);
  });

  it("detect() is false without a storage dir", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-oc-none-"));
    expect(await opencodeAdapter.detect(home)).toBe(false);
    expect(await loadOpencodeProjects(home)).toEqual([]);
  });
});

describe("antigravity adapter", () => {
  function fakeDb(): Buffer {
    const turn = (name?: string) =>
      Buffer.concat([
        Buffer.from([0, 1, 2]),
        Buffer.from("used_claude_conservative"),
        Buffer.from([0]),
        Buffer.from("false"),
        Buffer.from([0, 0]),
        Buffer.from(name ?? "zzzz"),
        Buffer.from([0, 3]),
      ]);
    return Buffer.concat([
      turn("Gemini 3.1 Pro (High)"),
      turn("Gemini 3.1 Pro (High)"),
      turn(), // unlabeled -> attributed to dominant model
      Buffer.from("z".repeat(8000)), // conversation content -> ~2000 estimated tokens
      Buffer.from([0]),
    ]);
  }

  it("estimates per-model usage from conversation dbs and history.jsonl", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-ag-"));
    const antigravity = ADAPTERS.find((a) => a.id === "antigravity")!;
    expect(antigravity.supported).toBe(true);
    expect(antigravity.estimated).toBe(true);
    expect(await antigravity.detect(home)).toBe(false);

    const root = join(home, ".gemini", "antigravity-cli");
    mkdirSync(join(root, "conversations"), { recursive: true });
    writeFileSync(join(root, "conversations", "abc.db"), fakeDb());
    writeFileSync(
      join(root, "history.jsonl"),
      JSON.stringify({
        display: "hi",
        timestamp: 1784286552893,
        workspace: "/home/me/rocket",
        conversationId: "abc",
      }) + "\n",
    );

    expect(await antigravity.detect(home)).toBe(true);
    const projects = await antigravity.loadProjects(home);
    expect(projects).toHaveLength(1);
    expect(projects[0].label).toBe("rocket");
    const u = projects[0].report.usageByModel["gemini-3.1-pro"];
    expect(u.turns).toBe(3);
    expect(u.inputTokens).toBeGreaterThan(1000);
    expect(u.outputTokens).toBeGreaterThan(100);
    expect(projects[0].report.totalCostUsd).toBeGreaterThan(0);
  });
});
