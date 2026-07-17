import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setLivePrices, type ModelPrice } from "./pricing.js";

// Live pricing from LiteLLM's catalog (same source as ccusage), so new models
// price correctly without a tokz release. Fetched at startup, cached on disk
// for a day; on offline/failure falls back to the cache, then static PRICES.

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;

interface PriceCache {
  fetchedAt: number;
  prices: Record<string, ModelPrice>;
}

interface LitellmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
}

/** Convert LiteLLM's per-token catalog into our per-MTok ModelPrice table. */
export function mapLitellmPrices(raw: Record<string, unknown>): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const e = value as LitellmEntry;
    const inCost = e.input_cost_per_token;
    const outCost = e.output_cost_per_token;
    if (typeof inCost !== "number" || typeof outCost !== "number" || inCost <= 0) continue;
    // Keys come both bare ("gpt-5.6-terra") and provider-prefixed
    // ("openai/gpt-5.6-terra"); prefer the bare entry when both exist.
    const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    if (key.includes("/") && out[name]) continue;
    const p: ModelPrice = { inputPerMTok: inCost * 1e6, outputPerMTok: outCost * 1e6 };
    if (typeof e.cache_read_input_token_cost === "number")
      p.cacheReadMult = e.cache_read_input_token_cost / inCost;
    if (typeof e.cache_creation_input_token_cost === "number")
      p.cacheWriteMult = e.cache_creation_input_token_cost / inCost;
    else if (!name.startsWith("claude"))
      p.cacheWriteMult = 0; // only Anthropic charges for cache writes
    if (typeof e.cache_creation_input_token_cost_above_1hr === "number")
      p.cacheWrite1hMult = e.cache_creation_input_token_cost_above_1hr / inCost;
    out[name] = p;
  }
  return out;
}

export type PricingSource = "live" | "cached" | "static";

export async function initPricing(opts?: {
  offline?: boolean;
  cacheDir?: string;
}): Promise<PricingSource> {
  const dir = opts?.cacheDir ?? join(homedir(), ".tokz");
  const file = join(dir, "litellm-prices.json");
  let cached: PriceCache | undefined;
  try {
    cached = JSON.parse(await readFile(file, "utf8")) as PriceCache;
  } catch {
    // no cache yet
  }
  const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (cached && (fresh || opts?.offline)) {
    setLivePrices(cached.prices);
    return "cached";
  }
  if (opts?.offline) return "static";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(LITELLM_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const prices = mapLitellmPrices((await res.json()) as Record<string, unknown>);
    setLivePrices(prices);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(file, JSON.stringify({ fetchedAt: Date.now(), prices } satisfies PriceCache));
    } catch {
      // cache write is best-effort
    }
    return "live";
  } catch {
    if (cached) {
      setLivePrices(cached.prices);
      return "cached";
    }
    return "static";
  }
}
