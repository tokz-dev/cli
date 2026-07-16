import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { glob } from "tinyglobby";
import { addUsage, buildReport, cacheHitRate, cacheSavings } from "./attribute.js";
import { sanitizeProjectPath } from "./discover.js";
import { findMcpServers } from "./mcp.js";
import { costUsd, emptyUsage } from "./pricing.js";
import { parseTranscript } from "./transcript.js";
import type {
  AuditReport,
  CostBreakdown,
  DailyStat,
  McpServer,
  ServerAudit,
  SessionStats,
  UsageTotals,
} from "./types.js";

export interface ProjectAudit {
  id: string;
  name: string;
  /** short display name: the project directory's basename */
  label: string;
  realPath?: string;
  report: AuditReport;
  /** raw parsed sessions, kept so reports can be rebuilt for a timeframe */
  sessions?: SessionStats[];
  serverList?: McpServer[];
}

/** Rebuild every project's report restricted to a date range; drops projects with no activity in it. */
export function applyTimeframe(
  projects: ProjectAudit[],
  range: { from: string; to: string } | undefined,
): ProjectAudit[] {
  if (!range) return projects;
  return projects
    .map((p) =>
      p.sessions
        ? { ...p, report: buildReport(p.sessions, p.serverList ?? [], range) }
        : p,
    )
    .filter((p) => !p.sessions || p.report.sessionCount > 0)
    .sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
}

export function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? p;
}

const DAY_MS = 86_400_000;

// Merge every project's report into one aggregate report (for the "all projects" view).
export function aggregate(projects: ProjectAudit[]): AuditReport {
  const usageByModel: Record<string, UsageTotals> = {};
  const toolCalls: Record<string, number> = {};
  const toolCostUsd: Record<string, number> = {};
  const serverByName = new Map<string, ServerAudit>();
  const dailyByDate = new Map<string, DailyStat>();
  const sessions: AuditReport["sessions"] = [];
  let sessionCount = 0;
  let totalTurns = 0;
  let start: string | undefined;
  let end: string | undefined;

  for (const { report } of projects) {
    sessionCount += report.sessionCount;
    totalTurns += report.totalTurns ?? 0;
    for (const [m, u] of Object.entries(report.usageByModel)) {
      addUsage((usageByModel[m] ??= emptyUsage()), u);
    }
    for (const [t, n] of Object.entries(report.toolCalls)) toolCalls[t] = (toolCalls[t] ?? 0) + n;
    for (const [t, c] of Object.entries(report.toolCostUsd ?? {})) {
      toolCostUsd[t] = (toolCostUsd[t] ?? 0) + c;
    }
    for (const s of report.servers) {
      const acc = serverByName.get(s.name);
      if (!acc) {
        serverByName.set(s.name, { ...s });
      } else {
        acc.callsObserved += s.callsObserved;
        acc.estCostUsd += s.estCostUsd ?? 0;
        acc.unused = acc.callsObserved === 0;
        acc.configured = acc.configured || s.configured;
      }
    }
    for (const d of report.daily ?? []) {
      const acc = dailyByDate.get(d.date);
      if (!acc) {
        dailyByDate.set(d.date, { ...d });
      } else {
        acc.costUsd += d.costUsd;
        acc.inputTokens += d.inputTokens;
        acc.cacheReadTokens += d.cacheReadTokens;
        acc.cacheCreationTokens += d.cacheCreationTokens;
        acc.outputTokens += d.outputTokens;
        acc.turns += d.turns;
      }
    }
    sessions.push(...(report.sessions ?? []));
    if (report.spanStart && (!start || report.spanStart < start)) start = report.spanStart;
    if (report.spanEnd && (!end || report.spanEnd > end)) end = report.spanEnd;
  }

  const costByModel: Record<string, CostBreakdown> = {};
  let totalCostUsd = 0;
  for (const [m, u] of Object.entries(usageByModel)) {
    costByModel[m] = costUsd(u, m);
    totalCostUsd += costByModel[m].total;
  }

  const spanDays =
    start && end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS)) : 1;

  return {
    sessionCount,
    spanDays,
    spanStart: start,
    spanEnd: end,
    usageByModel,
    costByModel,
    totalCostUsd,
    monthlyProjectionUsd: (totalCostUsd / spanDays) * 30,
    toolCalls,
    toolCostUsd,
    servers: [...serverByName.values()],
    daily: [...dailyByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    sessions: sessions.sort((a, b) => b.costUsd - a.costUsd),
    cacheSavingsUsd: cacheSavings(usageByModel),
    cacheHitRate: cacheHitRate(usageByModel),
    totalTurns,
  };
}

async function realPathsBySanitized(home: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const cfg = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
    const projects = cfg?.projects;
    if (projects && typeof projects === "object") {
      for (const p of Object.keys(projects)) map.set(sanitizeProjectPath(p), p);
    }
  } catch {
    /* missing/invalid config: no real paths */
  }
  return map;
}

export interface LoadProgress {
  parsed: number;
  total: number;
  currentProject?: string;
}

export async function loadProjects(
  home: string = homedir(),
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const root = join(home, ".claude", "projects");
  const files = await glob(["**/*.jsonl"], { cwd: root, absolute: true }).catch(() => []);
  if (files.length === 0) return [];

  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = relative(root, f).split(sep)[0];
    const list = byDir.get(dir) ?? [];
    list.push(f);
    byDir.set(dir, list);
  }

  const realMap = await realPathsBySanitized(home);
  const seenMessageIds = new Set<string>();
  const seenToolIds = new Set<string>();
  let parsed = 0;

  const out: ProjectAudit[] = [];
  for (const [dir, dirFiles] of byDir) {
    onProgress?.({ parsed, total: files.length, currentProject: realMap.get(dir) ?? dir });
    const sessions = [];
    for (const f of dirFiles) {
      sessions.push(await parseTranscript(f, seenMessageIds, seenToolIds));
      parsed += 1;
      onProgress?.({ parsed, total: files.length, currentProject: realMap.get(dir) ?? dir });
    }
    // Prefer the config-mapped path; fall back to the cwd recorded inside the transcripts.
    const realPath = realMap.get(dir) ?? sessions.find((s) => s.cwd)?.cwd;
    const servers = realPath ? await findMcpServers(realPath, home) : [];
    out.push({
      id: dir,
      name: realPath ?? dir,
      label: realPath ? baseName(realPath) : dir,
      realPath,
      report: buildReport(sessions, servers),
      sessions,
      serverList: servers,
    });
  }

  out.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  return out;
}
