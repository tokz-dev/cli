import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { glob } from "tinyglobby";
import { buildReport } from "./attribute.js";
import { sanitizeProjectPath } from "./discover.js";
import { findMcpServers } from "./mcp.js";
import { parseTranscript } from "./transcript.js";
import type { AuditReport } from "./types.js";

export interface ProjectAudit {
  id: string;
  name: string;
  realPath?: string;
  report: AuditReport;
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
