import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { z } from "zod";
import { buildReport } from "../attribute.js";
import { costUsd, emptyUsage } from "../pricing.js";
import { baseName, type LoadProgress, type ProjectAudit } from "../projects.js";
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
        .object({ total_token_usage: TokenTotals.optional() })
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
 * Parse one Codex rollout file. token_count events report cumulative totals,
 * so per-turn usage is the positive delta between consecutive events —
 * repeated snapshots produce a zero delta and are ignored.
 */
export async function parseCodexRollout(file: string): Promise<SessionStats> {
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

    const totals = payload?.type === "token_count" ? payload.info?.total_token_usage : undefined;
    if (!totals) continue;

    const cur = {
      input: totals.input_tokens,
      cached: totals.cached_input_tokens,
      output: totals.output_tokens,
      total: totals.total_tokens,
    };
    // A smaller cumulative total means the counter reset (compaction/new turn stream).
    if (cur.total < prev.total) prev = { input: 0, cached: 0, output: 0, total: 0 };
    const dInput = Math.max(0, cur.input - prev.input);
    const dCached = Math.max(0, cur.cached - prev.cached);
    const dOutput = Math.max(0, cur.output - prev.output);
    prev = cur;
    if (dInput + dOutput === 0) continue;

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

  const byCwd = new Map<string, SessionStats[]>();
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Codex sessions" });
    const s = await parseCodexRollout(f);
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Codex sessions" });
    if (Object.keys(s.usageByModel).length === 0) continue;
    const key = s.cwd ?? "(unknown project)";
    const list = byCwd.get(key) ?? [];
    list.push(s);
    byCwd.set(key, list);
  }

  const out: ProjectAudit[] = [];
  for (const [cwd, sessions] of byCwd) {
    out.push({
      id: `codex:${cwd}`,
      name: cwd,
      label: cwd === "(unknown project)" ? cwd : baseName(cwd),
      realPath: cwd,
      report: buildReport(sessions, []),
      sessions,
      serverList: [],
    });
  }
  out.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  return out;
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
