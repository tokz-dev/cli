import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { costUsd, emptyUsage } from "./pricing.js";
import type { SessionStats } from "./types.js";

const AssistantLine = z.object({
  type: z.literal("assistant"),
  cwd: z.string().optional(),
  timestamp: z.string().optional(),
  message: z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().catch(0).default(0),
        cache_creation_input_tokens: z.number().catch(0).default(0),
        cache_read_input_tokens: z.number().catch(0).default(0),
        output_tokens: z.number().catch(0).default(0),
      })
      .optional(),
    content: z
      .array(z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() }).passthrough())
      .optional(),
  }),
});

// Dedupe usage by message.id and tools by tool_use id; pass shared sets across
// files to also collapse resumed-session copies.
export async function parseTranscript(
  file: string,
  seenMessageIds: Set<string> = new Set(),
  seenToolIds: Set<string> = new Set(),
): Promise<SessionStats> {
  const stats: SessionStats = { file, usageByModel: {}, toolCalls: {}, toolCostUsd: {}, dailyUsage: {} };
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = AssistantLine.safeParse(raw);
    if (!parsed.success) continue;

    const { message, timestamp, cwd } = parsed.data;
    if (cwd && !stats.cwd) stats.cwd = cwd;
    if (timestamp) {
      if (!stats.firstTs) stats.firstTs = timestamp;
      stats.lastTs = timestamp;
    }
    const model = message.model ?? "unknown";
    const firstSeen = !message.id || !seenMessageIds.has(message.id);
    if (message.id) seenMessageIds.add(message.id);
    // "<synthetic>" marks Claude Code-injected placeholder turns with no real usage.
    let turnCost = 0;
    if (message.usage && firstSeen && model !== "<synthetic>") {
      const accs = [(stats.usageByModel[model] ??= emptyUsage())];
      if (timestamp) {
        const day = (stats.dailyUsage[timestamp.slice(0, 10)] ??= {});
        accs.push((day[model] ??= emptyUsage()));
      }
      for (const u of accs) {
        u.inputTokens += message.usage.input_tokens;
        u.cacheCreationTokens += message.usage.cache_creation_input_tokens;
        u.cacheReadTokens += message.usage.cache_read_input_tokens;
        u.outputTokens += message.usage.output_tokens;
        u.turns += 1;
      }
      turnCost = costUsd(
        {
          inputTokens: message.usage.input_tokens,
          cacheCreationTokens: message.usage.cache_creation_input_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens,
          outputTokens: message.usage.output_tokens,
          turns: 1,
        },
        model,
      ).total;
    }
    const turnTools: string[] = [];
    for (const block of message.content ?? []) {
      if (block.type !== "tool_use" || !block.name) continue;
      if (block.id) {
        if (seenToolIds.has(block.id)) continue;
        seenToolIds.add(block.id);
      }
      stats.toolCalls[block.name] = (stats.toolCalls[block.name] ?? 0) + 1;
      turnTools.push(block.name);
    }
    // Attribute this turn's cost evenly to the tools it invoked (estimate).
    if (turnCost > 0 && turnTools.length > 0) {
      const share = turnCost / turnTools.length;
      for (const name of turnTools) {
        stats.toolCostUsd[name] = (stats.toolCostUsd[name] ?? 0) + share;
      }
    }
  }
  return stats;
}
