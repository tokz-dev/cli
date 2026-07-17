import { describe, it, expect } from "vitest";
import { buildBlocks, burnRate, maxBlockTokens, type UsageEvent } from "../src/blocks.js";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-07-17T10:30:00.000Z");

function ev(offsetMs: number, output = 1000): UsageEvent {
  return {
    ts: T0 + offsetMs,
    model: "claude-opus-4-8",
    usage: {
      inputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: output,
      turns: 1,
    },
  };
}

describe("buildBlocks", () => {
  it("floors the block start to the hour and splits on the 5h boundary", () => {
    const events = [ev(0), ev(HOUR), ev(6 * HOUR)]; // third event is past 10:00+5h
    const blocks = buildBlocks(events, { now: T0 + 12 * HOUR });
    expect(blocks).toHaveLength(2);
    expect(new Date(blocks[0].start).toISOString()).toBe("2026-07-17T10:00:00.000Z");
    expect(blocks[0].end - blocks[0].start).toBe(5 * HOUR);
    expect(blocks[0].totalTokens).toBe(2 * 1100);
    expect(blocks[0].active).toBe(false);
    expect(new Date(blocks[1].start).toISOString()).toBe("2026-07-17T16:00:00.000Z");
    expect(blocks[0].costUsd).toBeGreaterThan(0);
  });

  it("marks the last block active while now is inside its window", () => {
    const blocks = buildBlocks([ev(0)], { now: T0 + HOUR });
    expect(blocks[0].active).toBe(true);
    const done = buildBlocks([ev(0)], { now: T0 + 6 * HOUR });
    expect(done[0].active).toBe(false);
  });

  it("burn rate projects tokens and cost to block end", () => {
    // one event at T0 with 1100 tokens, one an hour later; now = 2h after first
    const blocks = buildBlocks([ev(0), ev(HOUR)], { now: T0 + 2 * HOUR });
    const rate = burnRate(blocks[0], T0 + 2 * HOUR)!;
    expect(rate.tokensPerMinute).toBeCloseTo(2200 / 120, 5);
    // remaining until 10:00+5h from 12:30 = 2.5h
    expect(rate.remainingMs).toBe(2.5 * HOUR);
    expect(rate.projectedTokens).toBe(2200 + Math.round((2200 / 120) * 150));
    expect(burnRate(buildBlocks([ev(0)], { now: T0 + 6 * HOUR })[0])).toBeUndefined();
  });

  it("maxBlockTokens takes the biggest completed block", () => {
    const blocks = buildBlocks([ev(0, 5000), ev(6 * HOUR, 100)], { now: T0 + 7 * HOUR });
    // second block still active at now -> excluded
    expect(blocks[1].active).toBe(true);
    expect(maxBlockTokens(blocks)).toBe(5100);
  });
});
