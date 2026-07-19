import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { z } from "zod";
import { costUsd, emptyUsage } from "../pricing.js";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats, UsageTotals } from "../types.js";
import type { AgentAdapter } from "./types.js";

const TokenTotals = z.object({
  input_tokens: z.number().catch(0).default(0),
  cached_input_tokens: z.number().catch(0).default(0),
  output_tokens: z.number().catch(0).default(0),
  reasoning_output_tokens: z.number().catch(0).default(0),
  total_tokens: z.number().catch(0).default(0),
});

const Line = z.object({
  timestamp: z.string().optional(),
  type: z.string().optional(),
  // old-format meta lines carry cwd at the top level
  cwd: z.string().optional(),
  payload: z
    .object({
      type: z.string().optional(),
      cwd: z.string().optional(),
      model: z.string().optional(),
      name: z.string().optional(),
      info: z
        .object({
          total_token_usage: TokenTotals.optional(),
          // Codex writes the per-turn amount here directly; prefer it over
          // differencing cumulative totals.
          last_token_usage: TokenTotals.optional(),
        })
        .nullish(),
    })
    .passthrough()
    .optional(),
});

function codexHome(home?: string): string {
  if (home) return join(home, ".codex");
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

const DEFAULT_MODEL = "gpt-5";

/**
 * Parse one Codex rollout file. Per-turn usage comes from `last_token_usage`
 * when present; older files without it fall back to the positive delta between
 * consecutive cumulative `total_token_usage` snapshots.
 *
 * Codex forks/replays sessions (~half of all files carry `forked_from_id` /
 * `thread_spawn`), re-logging earlier token_count events verbatim into the new
 * file. `seen` dedups those replayed events across every file by their
 * (timestamp, model, token) identity so they are counted once — without it the
 * replayed history is double-counted (observed ~2x overcount).
 */
export async function parseCodexRollout(
  file: string,
  seen: Set<string> = new Set(),
): Promise<SessionStats> {
  const stats: SessionStats = { file, usageByModel: {}, toolCalls: {}, toolCostUsd: {}, dailyUsage: {} };
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });

  let model = DEFAULT_MODEL;
  let prev = { input: 0, cached: 0, output: 0, total: 0 };
  let turnTools: string[] = [];

  for await (const raw of rl) {
    if (!raw.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = Line.safeParse(obj);
    if (!parsed.success) continue;
    const { timestamp, type, payload } = parsed.data;

    if (!stats.cwd) stats.cwd = payload?.cwd ?? parsed.data.cwd;
    if (payload?.model) model = payload.model;
    if (timestamp) {
      if (!stats.firstTs) stats.firstTs = timestamp;
      stats.lastTs = timestamp;
    }

    // Tool calls: new format nests them in response_item payloads; the oldest
    // format put function_call objects at the top level.
    const toolName =
      payload?.type === "function_call" || payload?.type === "custom_tool_call"
        ? payload.name
        : payload?.type === "local_shell_call"
          ? "shell"
          : type === "function_call"
            ? (parsed.data as { name?: string }).name
            : undefined;
    if (toolName) {
      stats.toolCalls[toolName] = (stats.toolCalls[toolName] ?? 0) + 1;
      turnTools.push(toolName);
    }

    const info = payload?.type === "token_count" ? payload.info : undefined;
    const last = info?.last_token_usage;
    const totals = info?.total_token_usage;
    if (!last && !totals) continue;

    // The raw snapshot that identifies this event for cross-file dedup — the
    // same value a forked/replayed file re-logs verbatim.
    const idTotals = last ?? totals!;
    const dedupKey = `${timestamp ?? ""}|${model}|${idTotals.input_tokens}|${idTotals.cached_input_tokens}|${idTotals.output_tokens}|${idTotals.reasoning_output_tokens}|${idTotals.total_tokens}`;

    let dInput: number;
    let dCached: number;
    let dOutput: number;
    if (last) {
      // last_token_usage is already the per-turn amount — no differencing.
      dInput = last.input_tokens;
      dCached = last.cached_input_tokens;
      dOutput = last.output_tokens;
      // Keep prev aligned with the cumulative counter for any later
      // last-absent lines in this same file.
      if (totals) {
        prev = {
          input: totals.input_tokens,
          cached: totals.cached_input_tokens,
          output: totals.output_tokens,
          total: totals.total_tokens,
        };
      }
    } else {
      const cur = {
        input: totals!.input_tokens,
        cached: totals!.cached_input_tokens,
        output: totals!.output_tokens,
        total: totals!.total_tokens,
      };
      // A smaller cumulative total means the counter reset (compaction/new turn stream).
      if (cur.total < prev.total) prev = { input: 0, cached: 0, output: 0, total: 0 };
      dInput = Math.max(0, cur.input - prev.input);
      dCached = Math.max(0, cur.cached - prev.cached);
      dOutput = Math.max(0, cur.output - prev.output);
      prev = cur;
    }
    if (dInput + dOutput === 0) continue;

    // Drop replayed duplicates from forked sessions; keep the first occurrence.
    if (seen.has(dedupKey)) {
      turnTools = [];
      continue;
    }
    seen.add(dedupKey);

    const delta: UsageTotals = {
      // Codex's input_tokens INCLUDES cached tokens; split them out.
      inputTokens: Math.max(0, dInput - dCached),
      cacheReadTokens: dCached,
      cacheCreationTokens: 0,
      outputTokens: dOutput,
      turns: 1,
    };
    const accs = [(stats.usageByModel[model] ??= emptyUsage())];
    if (timestamp) {
      const day = (stats.dailyUsage[timestamp.slice(0, 10)] ??= {});
      accs.push((day[model] ??= emptyUsage()));
    }
    for (const u of accs) {
      u.inputTokens += delta.inputTokens;
      u.cacheReadTokens += delta.cacheReadTokens;
      u.outputTokens += delta.outputTokens;
      u.turns += 1;
    }
    const turnCost = costUsd(delta, model).total;
    if (turnCost > 0 && turnTools.length > 0) {
      const share = turnCost / turnTools.length;
      for (const name of turnTools) {
        stats.toolCostUsd[name] = (stats.toolCostUsd[name] ?? 0) + share;
      }
    }
    turnTools = [];
  }
  return stats;
}

export async function loadCodexProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const root = codexHome(home);
  const files = await glob(["sessions/**/*.jsonl", "archived_sessions/**/*.jsonl"], {
    cwd: root,
    absolute: true,
  }).catch(() => []);
  if (files.length === 0) return [];

  const sessions: SessionStats[] = [];
  // Shared across files so token_count events replayed into forked sessions
  // are counted once, not once per copy.
  const seen = new Set<string>();
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Codex sessions" });
    sessions.push(await parseCodexRollout(f, seen));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Codex sessions" });
  }
  return groupSessionsByCwd("codex", sessions);
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "OpenAI Codex",
  supported: true,
  async detect(home) {
    try {
      await access(join(codexHome(home), "sessions"));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadCodexProjects,
};
