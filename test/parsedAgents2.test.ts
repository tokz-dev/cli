import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAmpProjects } from "../src/agents/amp.js";
import { loadCopilotProjects, parseOtelFile } from "../src/agents/copilot.js";
import { loadConfig } from "../src/config.js";

function home(): string {
  return mkdtempSync(join(tmpdir(), "tokz-a2-"));
}
function write(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("amp adapter", () => {
  it("prefers the usage ledger and pulls cache tokens from the referenced message", async () => {
    const h = home();
    write(
      h,
      ".local/share/amp/threads/t1.json",
      JSON.stringify({
        id: "thread-1",
        messages: [
          { messageId: 5, role: "assistant", usage: { cacheCreationInputTokens: 40, cacheReadInputTokens: 900 } },
        ],
        usageLedger: {
          events: [{ model: "claude-sonnet-4-6", timestamp: "2026-07-10T00:00:00Z", toMessageId: 5, tokens: { input: 100, output: 50 } }],
        },
      }),
    );
    const p = await loadAmpProjects(h);
    const u = p[0].report.usageByModel["claude-sonnet-4-6"];
    expect(u.inputTokens).toBe(100);
    expect(u.outputTokens).toBe(50);
    expect(u.cacheReadTokens).toBe(900); // from message 5
    expect(u.cacheCreationTokens).toBe(40);
  });

  it("falls back to per-message usage when there is no ledger", async () => {
    const h = home();
    write(
      h,
      ".local/share/amp/threads/t2.json",
      JSON.stringify({
        id: "thread-2",
        messages: [
          { role: "user" },
          { role: "assistant", model: "gpt-5", timestamp: "2026-07-11T00:00:00Z", usage: { inputTokens: 200, outputTokens: 30, cacheReadInputTokens: 10 } },
        ],
      }),
    );
    const p = await loadAmpProjects(h);
    const u = p[0].report.usageByModel["gpt-5"];
    expect(u.inputTokens).toBe(200);
    expect(u.outputTokens).toBe(30);
    expect(u.cacheReadTokens).toBe(10);
  });
});

describe("copilot adapter (OTel)", () => {
  it("extracts gen_ai.usage.* from attributes and dedups repeated spans", () => {
    const rec = (id: string, input: number) => ({
      spanId: "s1",
      timestamp: "2026-07-12T00:00:00Z",
      attributes: {
        "gen_ai.response.id": id,
        "gen_ai.response.model": "gpt-5",
        "gen_ai.conversation.id": "conv-1",
        "gen_ai.usage.input_tokens": input,
        "gen_ai.usage.output_tokens": 20,
        "gen_ai.usage.cache_read.input_tokens": 300,
        "gen_ai.usage.reasoning.output_tokens": 5,
      },
    });
    // same response id twice -> counted once
    const bySession = parseOtelFile([rec("r1", 100), rec("r1", 100), rec("r2", 50)]);
    const records = bySession.get("conv-1")!;
    expect(records).toHaveLength(2);
    expect(records[0].input).toBe(100);
    expect(records[0].output).toBe(25); // 20 + 5 reasoning
    expect(records[0].cacheRead).toBe(300);
  });

  it("handles OTLP-wrapped attribute values", async () => {
    const h = home();
    write(
      h,
      ".copilot/otel/log.jsonl",
      JSON.stringify({
        attributes: {
          "gen_ai.response.model": { stringValue: "gpt-5-mini" },
          "gen_ai.usage.input_tokens": { intValue: 400 },
          "gen_ai.usage.output_tokens": { intValue: 60 },
        },
      }),
    );
    const p = await loadCopilotProjects(h);
    const u = p[0].report.usageByModel["gpt-5-mini"];
    expect(u.inputTokens).toBe(400);
    expect(u.outputTokens).toBe(60);
  });
});

describe("config file", () => {
  it("reads valid keys and ignores junk", () => {
    const h = home();
    write(h, ".tokz/config.json", JSON.stringify({ timezone: "Asia/Amman", offline: true, costSource: "calc", days: 7, bogus: 1 }));
    expect(loadConfig(h)).toEqual({ timezone: "Asia/Amman", offline: true, costSource: "calc", days: 7 });
  });

  it("returns empty defaults when missing or malformed", () => {
    expect(loadConfig(home())).toEqual({});
    const h = home();
    write(h, ".tokz/config.json", "{not json");
    expect(loadConfig(h)).toEqual({});
    const h2 = home();
    write(h2, ".tokz/config.json", JSON.stringify({ costSource: "nonsense" }));
    expect(loadConfig(h2)).toEqual({});
  });
});
