import { costUsd, emptyUsage } from "./pricing.js";
import { addUsage } from "./attribute.js";
import type { UsageTotals } from "./types.js";

// Claude usage limits run in rolling 5h windows: first message opens a block
// (start floored to the hour), it lasts 5h, next activity after expiry opens a
// new one. Same model ccusage uses.

export interface UsageEvent {
  ts: number; // ms epoch
  model: string;
  usage: UsageTotals;
}

export interface Block {
  start: number; // floored to the hour
  end: number; // start + sessionLength
  firstTs: number;
  lastTs: number;
  usageByModel: Record<string, UsageTotals>;
  totalTokens: number; // all token kinds, matching ccusage's block totals
  costUsd: number;
  active: boolean;
}

export const BLOCK_LENGTH_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function finalize(b: Block): Block {
  for (const [model, u] of Object.entries(b.usageByModel)) {
    b.totalTokens += u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens + u.outputTokens;
    b.costUsd += costUsd(u, model).total;
  }
  return b;
}

export function buildBlocks(
  events: UsageEvent[],
  opts?: { sessionLengthMs?: number; now?: number },
): Block[] {
  const len = opts?.sessionLengthMs ?? BLOCK_LENGTH_MS;
  const now = opts?.now ?? Date.now();
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const blocks: Block[] = [];
  let cur: Block | undefined;
  for (const e of sorted) {
    if (!cur || e.ts >= cur.end) {
      if (cur) blocks.push(finalize(cur));
      const start = Math.floor(e.ts / HOUR_MS) * HOUR_MS;
      cur = {
        start,
        end: start + len,
        firstTs: e.ts,
        lastTs: e.ts,
        usageByModel: {},
        totalTokens: 0,
        costUsd: 0,
        active: false,
      };
    }
    cur.lastTs = Math.max(cur.lastTs, e.ts);
    addUsage((cur.usageByModel[e.model] ??= emptyUsage()), e.usage);
  }
  if (cur) {
    cur.active = now < cur.end;
    blocks.push(finalize(cur));
  }
  return blocks;
}

export interface BurnRate {
  tokensPerMinute: number;
  costPerHour: number;
  projectedTokens: number;
  projectedCostUsd: number;
  remainingMs: number;
}

export function burnRate(b: Block, now: number = Date.now()): BurnRate | undefined {
  if (!b.active) return undefined;
  const elapsed = Math.max(60_000, now - b.firstTs);
  const remainingMs = Math.max(0, b.end - now);
  const tokensPerMinute = b.totalTokens / (elapsed / 60_000);
  const costPerHour = b.costUsd / (elapsed / HOUR_MS);
  return {
    tokensPerMinute,
    costPerHour,
    projectedTokens: Math.round(b.totalTokens + tokensPerMinute * (remainingMs / 60_000)),
    projectedCostUsd: b.costUsd + costPerHour * (remainingMs / HOUR_MS),
    remainingMs,
  };
}

/** "--token-limit max" -> the highest completed block's totalTokens. */
export function maxBlockTokens(blocks: Block[]): number {
  return blocks.filter((b) => !b.active).reduce((m, b) => Math.max(m, b.totalTokens), 0);
}
