import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJsonl, sessionFromRecords, str, type UsageRecord } from "./usage.js";

// OpenClaw (and its clawdbot/moltbot/moldbot forks): session *.jsonl files
// where `model_change`/`model-snapshot` lines set the current model and
// assistant lines carry message.usage {input, output, cacheRead, cacheWrite}.
const OPENCLAW_DIRS = [".openclaw", ".clawdbot", ".moltbot", ".moldbot"];

function openclawRoots(home?: string): string[] {
  const env = process.env.OPENCLAW_DIR;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  const h = home ?? homedir();
  return OPENCLAW_DIRS.map((d) => join(h, d));
}

function modelFrom(obj: unknown): string | undefined {
  return str(obj, "modelId") ?? str(obj, "model");
}

async function parseFile(file: string): Promise<SessionStats> {
  const records: UsageRecord[] = [];
  let currentModel: string | undefined;
  for (const line of await readJsonl(file)) {
    const l = line as { type?: string; data?: unknown; message?: unknown };
    if (l.type === "model_change" || l.type === "model-snapshot") {
      currentModel = modelFrom(l.data) ?? modelFrom(l) ?? currentModel;
      continue;
    }
    const usage = (l.message as { usage?: unknown })?.usage;
    if (!usage) continue;
    const model = modelFrom(l.message) ?? currentModel ?? "openclaw-unknown";
    records.push({
      model,
      ts: str(l.message, "timestamp") ?? str(l, "timestamp"),
      input: pickNum(usage, ["input"]),
      output: pickNum(usage, ["output"]),
      cacheRead: pickNum(usage, ["cacheRead"]),
      cacheWrite: pickNum(usage, ["cacheWrite"]),
    });
  }
  return sessionFromRecords(file, undefined, records);
}

export async function loadOpenclawProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files: string[] = [];
  for (const root of openclawRoots(home)) {
    files.push(...(await glob(["**/*.jsonl", "**/*.jsonl.*"], { cwd: root, absolute: true }).catch(() => [])));
  }
  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "OpenClaw sessions" });
    sessions.push(await parseFile(f));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "OpenClaw sessions" });
  }
  return groupSessionsByCwd("openclaw", sessions);
}

export const openclawAdapter: AgentAdapter = {
  id: "openclaw",
  name: "OpenClaw",
  supported: true,
  async detect(home) {
    for (const root of openclawRoots(home)) {
      try {
        await access(root);
        return true;
      } catch {
        // try next
      }
    }
    return false;
  },
  loadProjects: loadOpenclawProjects,
};
