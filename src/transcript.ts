import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { UsageEvent } from "./blocks.js";
import { dayKey } from "./dates.js";
import { costUsd, emptyUsage } from "./pricing.js";
import type { SessionStats, UsageTotals } from "./types.js";

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
        cache_creation: z
          .object({
            ephemeral_5m_input_tokens: z.number().catch(0).default(0),
            ephemeral_1h_input_tokens: z.number().catch(0).default(0),
          })
          .nullish(),
      })
      .optional(),
    content: z
      .array(z.object({ type: z.string(), id: z.string().optional(), name: z.string().optional() }).passthrough())
      .optional(),
  }),
});

/** Highest usage counted so far for one message id (across streamed lines and resumed-session copies). */
export interface CountedUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  output: number;
}

/**
 * Claude Code writes one line per streamed content block, all sharing the
 * message id, with usage that GROWS across lines (output_tokens on the first
 * block can be 1 while the last block carries the real total). Counting only
 * the first line undercounts output badly; counting every line overcounts.
 * So we accumulate the positive delta against the highest values seen per id.
 * Passing shared maps/sets across files also collapses resumed-session copies.
 */
export async function parseTranscript(
  file: string,
  seenMessages: Map<string, CountedUsage> = new Map(),
  seenToolIds: Set<string> = new Set(),
  events?: UsageEvent[],
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

    // "<synthetic>" marks Claude Code-injected placeholder turns with no real usage.
    let turnCost = 0;
    if (message.usage && model !== "<synthetic>") {
      const u = message.usage;
      const cur: CountedUsage = {
        input: u.input_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens,
        cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        output: u.output_tokens,
      };
      const prev = message.id ? seenMessages.get(message.id) : undefined;
      const delta: UsageTotals = {
        inputTokens: Math.max(0, cur.input - (prev?.input ?? 0)),
        cacheReadTokens: Math.max(0, cur.cacheRead - (prev?.cacheRead ?? 0)),
        cacheCreationTokens: Math.max(0, cur.cacheWrite - (prev?.cacheWrite ?? 0)),
        cacheCreation1hTokens: Math.max(0, cur.cacheWrite1h - (prev?.cacheWrite1h ?? 0)),
        outputTokens: Math.max(0, cur.output - (prev?.output ?? 0)),
        turns: prev ? 0 : 1,
      };
      if (message.id) {
        seenMessages.set(message.id, {
          input: Math.max(cur.input, prev?.input ?? 0),
          cacheRead: Math.max(cur.cacheRead, prev?.cacheRead ?? 0),
          cacheWrite: Math.max(cur.cacheWrite, prev?.cacheWrite ?? 0),
          cacheWrite1h: Math.max(cur.cacheWrite1h, prev?.cacheWrite1h ?? 0),
          output: Math.max(cur.output, prev?.output ?? 0),
        });
      }
      const hasDelta =
        delta.inputTokens + delta.cacheReadTokens + delta.cacheCreationTokens + delta.outputTokens > 0 ||
        delta.turns > 0;
      if (hasDelta) {
        const accs = [(stats.usageByModel[model] ??= emptyUsage())];
        if (timestamp) {
          const day = (stats.dailyUsage[dayKey(timestamp)] ??= {});
          accs.push((day[model] ??= emptyUsage()));
          events?.push({ ts: Date.parse(timestamp), model, usage: delta });
        }
        for (const acc of accs) {
          acc.inputTokens += delta.inputTokens;
          acc.cacheReadTokens += delta.cacheReadTokens;
          acc.cacheCreationTokens += delta.cacheCreationTokens;
          acc.cacheCreation1hTokens = (acc.cacheCreation1hTokens ?? 0) + (delta.cacheCreation1hTokens ?? 0);
          acc.outputTokens += delta.outputTokens;
          acc.turns += delta.turns;
        }
        turnCost = costUsd(delta, model).total;
      }
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
