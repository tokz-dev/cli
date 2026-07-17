import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { deepFind, pickNum, readJsonl, sessionFromRecords, str, type UsageRecord } from "./usage.js";

// Kimi CLI: ~/.kimi | ~/.kimi-code -> sessions/**/wire.jsonl. The usage object
// sits at a varying depth per line (new vs old wire format), so we locate it by
// its keys: inputOther/output/inputCacheCreation/inputCacheRead.
const KIMI_DIRS = [".kimi", ".kimi-code"];
const USAGE_KEYS = ["inputOther", "input_other", "inputCacheRead", "input_cache_read"];

function kimiRoots(home?: string): string[] {
  const env = process.env.KIMI_DATA_DIR;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  const h = home ?? homedir();
  return KIMI_DIRS.map((d) => join(h, d));
}

async function parseFile(file: string): Promise<SessionStats> {
  const records: UsageRecord[] = [];
  for (const line of await readJsonl(file)) {
    const usage = deepFind(line, USAGE_KEYS);
    if (!usage) continue;
    records.push({
      model: str(line, "model") ?? "kimi-unknown",
      ts: str(line, "timestamp"),
      input: pickNum(usage, ["inputOther", "input_other"]),
      output: pickNum(usage, ["output"]),
      cacheRead: pickNum(usage, ["inputCacheRead", "input_cache_read"]),
      cacheWrite: pickNum(usage, ["inputCacheCreation", "input_cache_creation"]),
    });
  }
  return sessionFromRecords(file, undefined, records);
}

export async function loadKimiProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files: string[] = [];
  for (const root of kimiRoots(home)) {
    files.push(
      ...(await glob(["sessions/**/wire.jsonl"], { cwd: root, absolute: true }).catch(() => [])),
    );
  }
  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Kimi sessions" });
    sessions.push(await parseFile(f));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Kimi sessions" });
  }
  return groupSessionsByCwd("kimi", sessions);
}

export const kimiAdapter: AgentAdapter = {
  id: "kimi",
  name: "Kimi CLI",
  supported: true,
  async detect(home) {
    for (const root of kimiRoots(home)) {
      try {
        await access(join(root, "sessions"));
        return true;
      } catch {}
    }
    return false;
  },
  loadProjects: loadKimiProjects,
};
