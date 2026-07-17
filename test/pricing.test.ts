import { describe, it, expect } from "vitest";
import { costUsd, resolvePrice } from "../src/pricing.js";

describe("pricing", () => {
  it("resolves dated model ids by prefix", () => {
    expect(resolvePrice("claude-haiku-4-5-20251001").inputPerMTok).toBe(1);
  });

  it("prices usage: input full, cache read 0.1x, cache write 1.25x", () => {
    const cost = costUsd(
      { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000, outputTokens: 1_000_000, turns: 1 },
      "claude-opus-4-8",
    );
    expect(cost.input).toBeCloseTo(5);
    expect(cost.cacheRead).toBeCloseTo(0.5);
    expect(cost.cacheWrite).toBeCloseTo(6.25);
    expect(cost.output).toBeCloseTo(25);
    expect(cost.total).toBeCloseTo(36.75);
  });

  it("falls back to opus pricing for unknown models", () => {
    expect(resolvePrice("claude-future-9").inputPerMTok).toBe(5);
  });

  it("prices gpt-5.6 tiers by longest prefix, not the gpt-5 fallback", () => {
    // Verified against ccusage/LiteLLM on real rollouts: 74,691 in + 365,312
    // cached + 1,728 out on gpt-5.6-terra bills $0.3039755.
    expect(resolvePrice("gpt-5.6-terra").inputPerMTok).toBe(2.5);
    expect(resolvePrice("gpt-5.6-sol").outputPerMTok).toBe(30);
    const cost = costUsd(
      { inputTokens: 74_691, cacheReadTokens: 365_312, cacheCreationTokens: 0, outputTokens: 1_728, turns: 11 },
      "gpt-5.6-terra",
    );
    expect(cost.total).toBeCloseTo(0.3039755, 6);
  });

  it("prices 1h cache writes at 2x input", () => {
    const cost = costUsd(
      {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 1_000_000,
        cacheCreation1hTokens: 1_000_000,
        outputTokens: 0,
        turns: 1,
      },
      "claude-opus-4-8",
    );
    expect(cost.cacheWrite).toBeCloseTo(10); // 2x $5, not 1.25x
  });

  it("splits mixed 5m/1h cache writes", () => {
    const cost = costUsd(
      {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 2_000_000,
        cacheCreation1hTokens: 1_000_000,
        outputTokens: 0,
        turns: 1,
      },
      "claude-opus-4-8",
    );
    expect(cost.cacheWrite).toBeCloseTo(10 + 6.25); // 1M @2x + 1M @1.25x
  });
});
