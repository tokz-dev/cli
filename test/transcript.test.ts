import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from "../src/transcript.js";

const lines = [
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T10:00:00Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 30000, output_tokens: 200 },
      content: [
        { type: "text", text: "hi" },
        { type: "tool_use", name: "mcp__context7__query-docs" },
        { type: "tool_use", name: "Read" },
      ],
    },
  }),
  '{"type":"user","message":{"content":"hello"}}',
  "not json at all",
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T11:00:00Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 },
      content: [{ type: "tool_use", name: "Read" }],
    },
  }),
].join("\n");

describe("parseTranscript", () => {
  it("accumulates usage per model and counts tool calls, skipping junk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokz-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, lines);

    const stats = await parseTranscript(file);
    const usage = stats.usageByModel["claude-opus-4-8"];
    expect(usage.inputTokens).toBe(110);
    expect(usage.cacheReadTokens).toBe(30000);
    expect(usage.cacheCreationTokens).toBe(50);
    expect(usage.outputTokens).toBe(220);
    expect(usage.turns).toBe(2);
    expect(stats.toolCalls["Read"]).toBe(2);
    expect(stats.toolCalls["mcp__context7__query-docs"]).toBe(1);
    expect(stats.firstTs).toBe("2026-07-01T10:00:00Z");
    expect(stats.lastTs).toBe("2026-07-01T11:00:00Z");
  });
});
