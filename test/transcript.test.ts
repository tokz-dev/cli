import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript, type CountedUsage } from "../src/transcript.js";

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

  it("splits each turn's cost across that turn's tool calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokz-cost-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, lines);

    const stats = await parseTranscript(file);
    // turn 1 (opus-4-8): 100 in + 50 cache-wr + 30k cache-rd + 200 out = $0.0208125, split 2 ways
    // turn 2: 10 in + 20 out = $0.00055, all to Read
    expect(stats.toolCostUsd["mcp__context7__query-docs"]).toBeCloseTo(0.01040625, 6);
    expect(stats.toolCostUsd["Read"]).toBeCloseTo(0.01040625 + 0.00055, 6);
  });

  it("takes the highest usage per message.id when streamed lines grow (real CC behavior)", async () => {
    // Streamed blocks repeat the message id with output_tokens growing: 1, 1, 638.
    const mkLine = (out: number, cw1h = 0) =>
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-07-01T10:00:00Z",
        message: {
          id: "msg_grow",
          model: "claude-haiku-4-5",
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 0,
            output_tokens: out,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: cw1h },
          },
          content: [],
        },
      });
    const dir = mkdtempSync(join(tmpdir(), "tokz-grow-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, [mkLine(1, 100), mkLine(1, 100), mkLine(638, 100)].join("\n"));

    const stats = await parseTranscript(file);
    const u = stats.usageByModel["claude-haiku-4-5"];
    expect(u.outputTokens).toBe(638); // max, not first (1) or sum (640)
    expect(u.inputTokens).toBe(10);
    expect(u.cacheCreationTokens).toBe(100);
    expect(u.cacheCreation1hTokens).toBe(100); // 1h tier tracked
    expect(u.turns).toBe(1);
  });

  it("counts usage once per message.id but tool_use on every line (block-split messages)", async () => {
    // Claude Code splits one API message across lines (thinking/text/tool_use),
    // each repeating the same usage. Usage must be counted once; each tool_use once.
    const split = [
      { type: "assistant", message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 }, content: [{ type: "thinking" }] } },
      { type: "assistant", message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 }, content: [{ type: "tool_use", name: "Read" }] } },
      { type: "assistant", message: { id: "msg_1", model: "claude-opus-4-8", usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 }, content: [{ type: "tool_use", name: "Bash" }] } },
    ].map((o) => JSON.stringify(o)).join("\n");

    const dir = mkdtempSync(join(tmpdir(), "tokz-split-"));
    const file = join(dir, "s.jsonl");
    writeFileSync(file, split);

    const stats = await parseTranscript(file);
    const u = stats.usageByModel["claude-opus-4-8"];
    expect(u.inputTokens).toBe(100); // counted once, not 300
    expect(u.outputTokens).toBe(50);
    expect(u.turns).toBe(1);
    expect(stats.toolCalls["Read"]).toBe(1);
    expect(stats.toolCalls["Bash"]).toBe(1);
  });

  it("dedupes the same message.id across files via a shared set (resumed sessions)", async () => {
    const mk = (dirPrefix: string) => {
      const dir = mkdtempSync(join(tmpdir(), dirPrefix));
      const file = join(dir, "s.jsonl");
      writeFileSync(file, JSON.stringify({ type: "assistant", message: { id: "msg_dup", model: "claude-opus-4-8", usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 50 }, content: [] } }));
      return file;
    };
    const a = mk("tokz-r1-");
    const b = mk("tokz-r2-");
    const seen = new Map<string, CountedUsage>();
    const sa = await parseTranscript(a, seen);
    const sb = await parseTranscript(b, seen);
    const total = (sa.usageByModel["claude-opus-4-8"]?.inputTokens ?? 0) + (sb.usageByModel["claude-opus-4-8"]?.inputTokens ?? 0);
    expect(total).toBe(100); // counted once across both files, not 200
  });

  it("dedupes tool_use by block id across files (resumed sessions copy tool calls)", async () => {
    const mk = (prefix: string, msgId: string) => {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      const file = join(dir, "s.jsonl");
      writeFileSync(file, JSON.stringify({ type: "assistant", message: { id: msgId, model: "claude-opus-4-8", content: [{ type: "tool_use", id: "toolu_same", name: "Bash" }] } }));
      return file;
    };
    // Same tool_use block id in two files, different message ids.
    const a = mk("tokz-t1-", "msg_a");
    const b = mk("tokz-t2-", "msg_b");
    const seenMsg = new Map<string, CountedUsage>();
    const seenTool = new Set<string>();
    const sa = await parseTranscript(a, seenMsg, seenTool);
    const sb = await parseTranscript(b, seenMsg, seenTool);
    const bash = (sa.toolCalls["Bash"] ?? 0) + (sb.toolCalls["Bash"] ?? 0);
    expect(bash).toBe(1); // one real call, not double-counted across the copy
  });
});
