import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { emptyUsage } from "./pricing.js";
import type { SessionStats } from "./types.js";

const AssistantLine = z.object({
  type: z.literal("assistant"),
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
      .array(z.object({ type: z.string(), name: z.string().optional() }).passthrough())
      .optional(),
  }),
});

// Claude Code writes one transcript line per content block (thinking/text/tool_use),
// each repeating the SAME message.usage; resumed sessions also copy prior messages
// into new files. Both inflate token totals, so usage is counted once per message.id.
// `seenMessageIds` must be shared across every file in a run for cross-file dedup.
export async function parseTranscript(
  file: string,
  seenMessageIds: Set<string> = new Set(),
): Promise<SessionStats> {
  const stats: SessionStats = { file, usageByModel: {}, toolCalls: {} };
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

    const { message, timestamp } = parsed.data;
    if (timestamp) {
      if (!stats.firstTs) stats.firstTs = timestamp;
      stats.lastTs = timestamp;
    }
    const model = message.model ?? "unknown";
    // Dedupe usage by message.id: block-split lines and resumed-session copies
    // repeat identical usage. Lines without an id (rare) are always counted.
    const firstSeen = !message.id || !seenMessageIds.has(message.id);
    if (message.id) seenMessageIds.add(message.id);
    if (message.usage && firstSeen) {
      const u = (stats.usageByModel[model] ??= emptyUsage());
      u.inputTokens += message.usage.input_tokens;
      u.cacheCreationTokens += message.usage.cache_creation_input_tokens;
      u.cacheReadTokens += message.usage.cache_read_input_tokens;
      u.outputTokens += message.usage.output_tokens;
      u.turns += 1;
    }
    for (const block of message.content ?? []) {
      if (block.type === "tool_use" && block.name) {
        stats.toolCalls[block.name] = (stats.toolCalls[block.name] ?? 0) + 1;
      }
    }
  }
  return stats;
}
