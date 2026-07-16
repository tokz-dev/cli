import type { CostBreakdown, UsageTotals } from "./types.js";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

// USD per million tokens. Cached from Anthropic docs 2026-06-24.
export const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;
const FALLBACK = PRICES["claude-opus-4-8"];

export function resolvePrice(modelId: string): ModelPrice {
  for (const [prefix, price] of Object.entries(PRICES)) {
    if (modelId.startsWith(prefix)) return price;
  }
  return FALLBACK;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 0 };
}

export function costUsd(usage: UsageTotals, modelId: string): CostBreakdown {
  const p = resolvePrice(modelId);
  const input = (usage.inputTokens / 1e6) * p.inputPerMTok;
  const cacheRead = (usage.cacheReadTokens / 1e6) * p.inputPerMTok * CACHE_READ_MULT;
  const cacheWrite = (usage.cacheCreationTokens / 1e6) * p.inputPerMTok * CACHE_WRITE_MULT;
  const output = (usage.outputTokens / 1e6) * p.outputPerMTok;
  return { input, cacheRead, cacheWrite, output, total: input + cacheRead + cacheWrite + output };
}
