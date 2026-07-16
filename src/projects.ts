import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { glob } from "tinyglobby";
import { buildReport } from "./attribute.js";
import { sanitizeProjectPath } from "./discover.js";
import { findMcpServers } from "./mcp.js";
import { costUsd, emptyUsage } from "./pricing.js";
import { parseTranscript } from "./transcript.js";
import type { AuditReport, CostBreakdown, ServerAudit, UsageTotals } from "./types.js";

export interface ProjectAudit {
  id: string;
  name: string;
  realPath?: string;
  report: AuditReport;
}

const DAY_MS = 86_400_000;

// Merge every project's report into one aggregate report (for the "all projects" view).
export function aggregate(projects: ProjectAudit[]): AuditReport {
  const usageByModel: Record<string, UsageTotals> = {};
  const toolCalls: Record<string, number> = {};
  const servers: ServerAudit[] = [];
  const seenServer = new Set<string>();
  let sessionCount = 0;
  let start: string | undefined;
  let end: string | undefined;

  for (const { report } of projects) {
    sessionCount += report.sessionCount;
    for (const [m, u] of Object.entries(report.usageByModel)) {
      const acc = (usageByModel[m] ??= emptyUsage());
      acc.inputTokens += u.inputTokens;
      acc.cacheReadTokens += u.cacheReadTokens;
      acc.cacheCreationTokens += u.cacheCreationTokens;
      acc.outputTokens += u.outputTokens;
      acc.turns += u.turns;
    }
    for (const [t, n] of Object.entries(report.toolCalls)) toolCalls[t] = (toolCalls[t] ?? 0) + n;
    for (const s of report.servers) {
      if (!seenServer.has(s.name)) {
        seenServer.add(s.name);
        servers.push({ ...s });
      }
    }
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
    servers,
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

export async function loadProjects(home: string = homedir()): Promise<ProjectAudit[]> {
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

  const out: ProjectAudit[] = [];
  for (const [dir, dirFiles] of byDir) {
    const sessions = await Promise.all(
      dirFiles.map((f) => parseTranscript(f, seenMessageIds, seenToolIds)),
    );
    const realPath = realMap.get(dir);
    const servers = realPath ? await findMcpServers(realPath, home) : [];
    out.push({ id: dir, name: realPath ?? dir, realPath, report: buildReport(sessions, servers) });
  }

  out.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  return out;
}
