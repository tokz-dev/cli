import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS } from "../src/agents/index.js";
import { loadPiProjects } from "../src/agents/pi.js";
import { loadOpenclawProjects } from "../src/agents/openclaw.js";
import { loadQwenProjects } from "../src/agents/qwen.js";
import { loadDroidProjects } from "../src/agents/droid.js";
import { loadCodebuffProjects } from "../src/agents/codebuff.js";
import { loadGeminiProjects } from "../src/agents/gemini.js";
import { loadKimiProjects } from "../src/agents/kimi.js";

function home(): string {
  return mkdtempSync(join(tmpdir(), "tokz-agents-"));
}
function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}
function usage(projects: { report: { usageByModel: Record<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }> } }[], model: string) {
  return projects[0].report.usageByModel[model];
}

describe("pi adapter", () => {
  it("reads message.usage from ~/.pi/agent/sessions/**/*.jsonl", async () => {
    const h = home();
    write(
      h,
      ".pi/agent/sessions/s1.jsonl",
      [
        JSON.stringify({ type: "x", timestamp: "2026-07-10T10:00:00Z", message: { role: "assistant", model: "pi-model", usage: { input: 100, output: 20, cacheRead: 50, cacheWrite: 5 } } }),
        JSON.stringify({ type: "user", message: { role: "user" } }),
      ].join("\n"),
    );
    const p = await loadPiProjects(h);
    const u = usage(p, "pi-model");
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(20);
    expect(u.cacheReadTokens).toBe(50);
    expect(u.cacheCreationTokens).toBe(5);
  });
});

describe("openclaw adapter", () => {
  it("tracks model via model_change and reads assistant usage", async () => {
    const h = home();
    write(
      h,
      ".openclaw/sessions/a.jsonl",
      [
        JSON.stringify({ type: "model_change", data: { modelId: "glm-4.6" } }),
        JSON.stringify({ message: { role: "assistant", usage: { input: 200, output: 40, cacheRead: 10, cacheWrite: 2 } }, timestamp: "2026-07-11T00:00:00Z" }),
      ].join("\n"),
    );
    const p = await loadOpenclawProjects(h);
    const u = usage(p, "glm-4.6");
    expect(u.inputTokens).toBe(200);
    expect(u.cacheReadTokens).toBe(10);
    expect(u.cacheCreationTokens).toBe(2);
  });
});

describe("qwen adapter", () => {
  it("reads Gemini-shaped usageMetadata and splits cached out of input", async () => {
    const h = home();
    write(
      h,
      ".qwen/projects/p1/chat.jsonl",
      JSON.stringify({ type: "assistant", timestamp: "2026-07-12T00:00:00Z", model: "qwen3-coder", usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 50, cachedContentTokenCount: 400 } }),
    );
    const p = await loadQwenProjects(h);
    const u = usage(p, "qwen3-coder");
    expect(u.inputTokens).toBe(600); // 1000 prompt - 400 cached
    expect(u.cacheReadTokens).toBe(400);
    expect(u.outputTokens).toBe(250); // 200 candidates + 50 thoughts
  });
});

describe("droid adapter", () => {
  it("reads tokenUsage from *.settings.json", async () => {
    const h = home();
    write(
      h,
      ".factory/sessions/abc.settings.json",
      JSON.stringify({ model: "claude-sonnet-4-6", updatedAt: "2026-07-13T00:00:00Z", tokenUsage: { inputTokens: 300, outputTokens: 60, cacheReadTokens: 20, cacheCreationTokens: 4, thinkingTokens: 10 } }),
    );
    const p = await loadDroidProjects(h);
    const u = usage(p, "claude-sonnet-4-6");
    expect(u.inputTokens).toBe(300);
    expect(u.outputTokens).toBe(70); // 60 + 10 thinking
    expect(u.cacheCreationTokens).toBe(4);
  });
});

describe("codebuff adapter", () => {
  it("reads assistant metadata.usage from chat-messages.json", async () => {
    const h = home();
    write(
      h,
      ".config/manicode/projects/p/chat-messages.json",
      JSON.stringify([
        { role: "user" },
        { role: "assistant", timestamp: "2026-07-14T00:00:00Z", metadata: { model: "gpt-5", usage: { inputTokens: 500, outputTokens: 80, cacheReadInputTokens: 30 } } },
      ]),
    );
    const p = await loadCodebuffProjects(h);
    const u = usage(p, "gpt-5");
    expect(u.inputTokens).toBe(500);
    expect(u.outputTokens).toBe(80);
    expect(u.cacheReadTokens).toBe(30);
  });
});

describe("gemini adapter", () => {
  it("reads a tokens object from jsonl logs (key aliases)", async () => {
    const h = home();
    write(
      h,
      ".gemini/tmp/x/log.jsonl",
      JSON.stringify({ model: "gemini-3.1-pro", timestamp: "2026-07-15T00:00:00Z", tokens: { prompt: 800, candidates: 100, cached: 200, thoughts: 30 } }),
    );
    const p = await loadGeminiProjects(h);
    const u = usage(p, "gemini-3.1-pro");
    expect(u.inputTokens).toBe(800);
    expect(u.outputTokens).toBe(130); // 100 + 30 thoughts
    expect(u.cacheReadTokens).toBe(200);
  });
});

describe("kimi adapter", () => {
  it("locates the usage object by key regardless of nesting", async () => {
    const h = home();
    write(
      h,
      ".kimi/sessions/s/wire.jsonl",
      JSON.stringify({ model: "kimi-k2", timestamp: "2026-07-16T00:00:00Z", message: { payload: { usage: { inputOther: 400, output: 70, inputCacheRead: 25, inputCacheCreation: 5 } } } }),
    );
    const p = await loadKimiProjects(h);
    const u = usage(p, "kimi-k2");
    expect(u.inputTokens).toBe(400);
    expect(u.outputTokens).toBe(70);
    expect(u.cacheReadTokens).toBe(25);
    expect(u.cacheCreationTokens).toBe(5);
  });
});

describe("registry", () => {
  it("registers every ccusage agent, parsed or detect-only", () => {
    const ids = ADAPTERS.map((a) => a.id);
    for (const id of ["claude", "codex", "opencode", "gemini", "qwen", "droid", "codebuff", "openclaw", "kimi", "pi", "goose", "hermes", "kilo", "copilot", "amp"]) {
      expect(ids).toContain(id);
    }
    // Copilot (OTel) and Amp (ledger) stay detect-only; Cursor keeps no local
    // token counts, so it's surfaced with that reason rather than parsed.
    const cursor = ADAPTERS.find((a) => a.id === "cursor")!;
    expect(cursor.supported).toBe(false);
    expect(cursor.unsupportedReason).toContain("server-side");
  });
});
