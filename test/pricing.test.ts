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
});
