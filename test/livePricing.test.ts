import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initPricing, mapLitellmPrices } from "../src/livePricing.js";
import { resolvePrice, setLivePrices } from "../src/pricing.js";

afterEach(() => setLivePrices({}));

describe("mapLitellmPrices", () => {
  it("converts per-token costs to per-MTok with cache multipliers", () => {
    const prices = mapLitellmPrices({
      "claude-sonnet-5": {
        input_cost_per_token: 2e-6,
        output_cost_per_token: 10e-6,
        cache_read_input_token_cost: 0.2e-6,
        cache_creation_input_token_cost: 2.5e-6,
        cache_creation_input_token_cost_above_1hr: 4e-6,
      },
      "openai/gpt-5.6-terra": {
        input_cost_per_token: 2.5e-6,
        output_cost_per_token: 15e-6,
        cache_read_input_token_cost: 0.25e-6,
      },
      "sample_spec": { input_cost_per_token: 0, output_cost_per_token: 0 },
    });
    const sonnet = prices["claude-sonnet-5"];
    expect(sonnet.inputPerMTok).toBe(2);
    expect(sonnet.outputPerMTok).toBe(10);
    expect(sonnet.cacheReadMult).toBeCloseTo(0.1, 10);
    expect(sonnet.cacheWriteMult).toBeCloseTo(1.25, 10);
    expect(sonnet.cacheWrite1hMult).toBeCloseTo(2, 10);
    // provider prefix stripped; non-Anthropic without a write price pays 0 for writes
    const terra = prices["gpt-5.6-terra"];
    expect(terra.inputPerMTok).toBe(2.5);
    expect(terra.outputPerMTok).toBe(15);
    expect(terra.cacheReadMult).toBeCloseTo(0.1, 10);
    expect(terra.cacheWriteMult).toBe(0);
    expect(prices["sample_spec"]).toBeUndefined();
  });

  it("prefers the bare key over a provider-prefixed duplicate", () => {
    const prices = mapLitellmPrices({
      "gpt-x": { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
      "azure/gpt-x": { input_cost_per_token: 9e-6, output_cost_per_token: 9e-6 },
    });
    expect(prices["gpt-x"].inputPerMTok).toBe(1);
  });
});

describe("live price resolution", () => {
  it("live exact match beats the static prefix table", () => {
    setLivePrices({ "gpt-6-new": { inputPerMTok: 7, outputPerMTok: 21 } });
    expect(resolvePrice("gpt-6-new").inputPerMTok).toBe(7);
    // unknown model with no live entry still falls back to static behavior
    expect(resolvePrice("gpt-5.6-terra").inputPerMTok).toBe(2.5);
  });
});

describe("initPricing", () => {
  it("uses the disk cache when offline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokz-prices-"));
    writeFileSync(
      join(dir, "litellm-prices.json"),
      JSON.stringify({
        fetchedAt: Date.now(),
        prices: { "model-from-cache": { inputPerMTok: 3, outputPerMTok: 6 } },
      }),
    );
    expect(await initPricing({ offline: true, cacheDir: dir })).toBe("cached");
    expect(resolvePrice("model-from-cache").inputPerMTok).toBe(3);
  });

  it("falls back to static with no cache and offline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokz-noprices-"));
    expect(await initPricing({ offline: true, cacheDir: dir })).toBe("static");
  });
});
