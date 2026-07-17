import { readFile, stat } from "node:fs/promises";
import pc from "picocolors";
import { buildBlocks, burnRate, type UsageEvent } from "./blocks.js";
import { fmtMs } from "./blocksReport.js";
import { dayKey } from "./dates.js";
import { findTranscripts } from "./discover.js";
import { compact, shortModel, usd } from "./format.js";
import { costUsd } from "./pricing.js";
import { parseTranscript, type CountedUsage } from "./transcript.js";

/**
 * `tokz statusline` — one compact line for Claude Code's statusLine hook.
 * Claude Code pipes session JSON on stdin; we add today's total, the active
 * 5-hour block, burn rate, and context usage from the local transcripts.
 * Must stay fast: only transcripts touched in the last ~6h are parsed, and
 * pricing comes from the disk cache (never a network fetch).
 */

interface StatuslineInput {
  session_id?: string;
  transcript_path?: string;
  model?: { id?: string; display_name?: string };
  cost?: { total_cost_usd?: number };
}

const CONTEXT_WINDOW = 200_000;
const LOOKBACK_MS = 6 * 60 * 60 * 1000;

/** Context tokens of the newest assistant message (input + cache = what's loaded). */
async function lastContextTokens(transcriptPath: string): Promise<number | undefined> {
  try {
    const lines = (await readFile(transcriptPath, "utf8")).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const j = JSON.parse(lines[i]);
        const u = j?.message?.usage;
        if (u && typeof u.input_tokens === "number") {
          return (
            u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          );
        }
      } catch {
        // keep scanning
      }
    }
  } catch {
    // no transcript
  }
  return undefined;
}

export async function statusline(
  input: StatuslineInput,
  now: number = Date.now(),
  home?: string,
): Promise<string> {
  const files = await findTranscripts(undefined, home);
  const recent: string[] = [];
  await Promise.all(
    files.map(async (f) => {
      try {
        if ((await stat(f)).mtimeMs >= now - Math.max(LOOKBACK_MS, msSinceMidnight(now) + 60_000))
          recent.push(f);
      } catch {
        // unreadable file
      }
    }),
  );

  const seen = new Map<string, CountedUsage>();
  const seenTools = new Set<string>();
  const events: UsageEvent[] = [];
  const sessions = await Promise.all(recent.map((f) => parseTranscript(f, seen, seenTools, events)));

  const today = dayKey(now);
  let todayCost = 0;
  let sessionCost: number | undefined = input.cost?.total_cost_usd;
  for (const s of sessions) {
    for (const [model, u] of Object.entries(s.dailyUsage[today] ?? {})) todayCost += costUsd(u, model).total;
    if (sessionCost === undefined && input.transcript_path && s.file === input.transcript_path) {
      sessionCost = Object.entries(s.usageByModel).reduce((sum, [m, u]) => sum + costUsd(u, m).total, 0);
    }
  }

  const blocks = buildBlocks(events, { now });
  const active = blocks.find((b) => b.active);
  const rate = active ? burnRate(active, now) : undefined;

  const model = input.model?.display_name ?? shortModel(input.model?.id ?? "?");
  const parts = [`🤖 ${model}`];

  const costs = [
    sessionCost !== undefined ? `${usd(sessionCost)} session` : undefined,
    `${usd(todayCost)} today`,
    active ? `${usd(active.costUsd)} block (${fmtMs(active.end - now)} left)` : undefined,
  ].filter(Boolean);
  parts.push(`💰 ${costs.join(" / ")}`);

  if (rate) parts.push(`🔥 ${usd(rate.costPerHour)}/hr`);

  const ctx = input.transcript_path ? await lastContextTokens(input.transcript_path) : undefined;
  if (ctx !== undefined) {
    const p = Math.round((ctx / CONTEXT_WINDOW) * 100);
    const colored = p >= 80 ? pc.red(`${p}%`) : p >= 50 ? pc.yellow(`${p}%`) : pc.green(`${p}%`);
    parts.push(`🧠 ${compact(ctx)} (${colored})`);
  }

  return parts.join(pc.dim(" | "));
}

function msSinceMidnight(now: number): number {
  const day = dayKey(now);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  // dayKey may be in a non-UTC zone; clamp into [0, 36h] to stay safe
  const diff = now - midnight;
  return Math.min(Math.max(diff, 0), 36 * 60 * 60 * 1000);
}

export async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}
