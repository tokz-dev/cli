import type { CostBreakdown, UsageTotals } from "./types.js";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** cache read price as a fraction of input price (default 0.1) */
  cacheReadMult?: number;
  /** cache write price as a fraction of input price (default: provider-specific) */
  cacheWriteMult?: number;
  /** 1-hour-tier cache write price as a fraction of input price (Anthropic bills 2x) */
  cacheWrite1hMult?: number;
}

// USD per million tokens. Anthropic cached 2026-06-24; OpenAI/Google cached 2026-07-17.
// Longest matching prefix wins, so "gpt-5-mini" beats "gpt-5".
export const PRICES: Record<string, ModelPrice> = {
  // Anthropic (cache write 1.25x input, cache read 0.1x)
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  // introductory pricing ($2/$10) through 2026-08-31; sticker is $3/$15 after
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  // OpenAI (no cache-write charge; cached input 0.1x)
  "gpt-5.6-sol": { inputPerMTok: 5, outputPerMTok: 30, cacheWriteMult: 0 },
  "gpt-5.6-terra": { inputPerMTok: 2.5, outputPerMTok: 15, cacheWriteMult: 0 },
  "gpt-5.6-luna": { inputPerMTok: 1, outputPerMTok: 6, cacheWriteMult: 0 },
  "gpt-5.5-pro": { inputPerMTok: 30, outputPerMTok: 180, cacheWriteMult: 0, cacheReadMult: 1 },
  "gpt-5.5": { inputPerMTok: 5, outputPerMTok: 30, cacheWriteMult: 0 },
  "gpt-5-codex": { inputPerMTok: 1.25, outputPerMTok: 10, cacheWriteMult: 0 },
  "gpt-5-mini": { inputPerMTok: 0.25, outputPerMTok: 2, cacheWriteMult: 0 },
  "gpt-5-nano": { inputPerMTok: 0.05, outputPerMTok: 0.4, cacheWriteMult: 0 },
  "gpt-5": { inputPerMTok: 1.25, outputPerMTok: 10, cacheWriteMult: 0 },
  "gpt-4.1-mini": { inputPerMTok: 0.4, outputPerMTok: 1.6, cacheWriteMult: 0, cacheReadMult: 0.25 },
  "gpt-4.1": { inputPerMTok: 2, outputPerMTok: 8, cacheWriteMult: 0, cacheReadMult: 0.25 },
  "codex-mini": { inputPerMTok: 1.5, outputPerMTok: 6, cacheWriteMult: 0, cacheReadMult: 0.25 },
  "o4-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4, cacheWriteMult: 0, cacheReadMult: 0.25 },
  o3: { inputPerMTok: 2, outputPerMTok: 8, cacheWriteMult: 0, cacheReadMult: 0.25 },
  // Google
  "gemini-3.1-pro": { inputPerMTok: 2, outputPerMTok: 12, cacheWriteMult: 0 },
  "gemini-3.5-flash": { inputPerMTok: 1.5, outputPerMTok: 9, cacheWriteMult: 0 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10, cacheWriteMult: 0 },
  "gemini-2.5-flash": { inputPerMTok: 0.3, outputPerMTok: 2.5, cacheWriteMult: 0 },
};

const DEFAULT_CACHE_READ_MULT = 0.1;
const DEFAULT_CACHE_WRITE_MULT = 1.25;
const CLAUDE_FALLBACK = PRICES["claude-opus-4-8"];
// Unknown non-Claude models cost $0 rather than being priced like the wrong provider.
const UNKNOWN: ModelPrice = { inputPerMTok: 0, outputPerMTok: 0 };

// Live pricing (LiteLLM's model catalog) loaded at CLI startup by
// initPricing(); the static PRICES table above is the offline seed.
let livePrices: Record<string, ModelPrice> = {};
const resolveCache = new Map<string, ModelPrice>();

export function setLivePrices(prices: Record<string, ModelPrice>): void {
  livePrices = prices;
  resolveCache.clear();
}

function longestPrefix(modelId: string, table: Record<string, ModelPrice>): ModelPrice | undefined {
  let best: ModelPrice | undefined;
  let bestLen = -1;
  for (const [prefix, price] of Object.entries(table)) {
    if (modelId.startsWith(prefix) && prefix.length > bestLen) {
      best = price;
      bestLen = prefix.length;
    }
  }
  return best;
}

export function resolvePrice(modelId: string): ModelPrice {
  const hit = resolveCache.get(modelId);
  if (hit) return hit;
  // Live exact match wins; the curated static table handles prefix matching
  // for dated ids (and keeps intentional overrides); live prefix match is the
  // catch-all for models the static table has never heard of.
  const price =
    livePrices[modelId] ??
    longestPrefix(modelId, PRICES) ??
    longestPrefix(modelId, livePrices) ??
    (modelId.startsWith("claude") ? CLAUDE_FALLBACK : UNKNOWN);
  resolveCache.set(modelId, price);
  return price;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 0 };
}

// Anthropic bills 1-hour cache writes at 2x input (5-minute writes at 1.25x).
const CACHE_WRITE_1H_MULT = 2;

export function costUsd(usage: UsageTotals, modelId: string): CostBreakdown {
  const p = resolvePrice(modelId);
  const readMult = p.cacheReadMult ?? DEFAULT_CACHE_READ_MULT;
  const writeMult = p.cacheWriteMult ?? DEFAULT_CACHE_WRITE_MULT;
  const input = (usage.inputTokens / 1e6) * p.inputPerMTok;
  const cacheRead = (usage.cacheReadTokens / 1e6) * p.inputPerMTok * readMult;
  const write1h = Math.min(usage.cacheCreation1hTokens ?? 0, usage.cacheCreationTokens);
  const write5m = usage.cacheCreationTokens - write1h;
  const write1hMult = p.cacheWrite1hMult ?? (p.cacheWriteMult === 0 ? 0 : CACHE_WRITE_1H_MULT);
  const cacheWrite =
    (write5m / 1e6) * p.inputPerMTok * writeMult + (write1h / 1e6) * p.inputPerMTok * write1hMult;
  const output = (usage.outputTokens / 1e6) * p.outputPerMTok;
  return { input, cacheRead, cacheWrite, output, total: input + cacheRead + cacheWrite + output };
}
