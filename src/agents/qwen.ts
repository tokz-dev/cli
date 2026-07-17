import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJsonl, sessionFromRecords, str, type UsageRecord } from "./usage.js";

// Qwen Code: ~/.qwen/projects/**/*.jsonl, Gemini-API shaped — each line carries
// a `usageMetadata` object. promptTokenCount includes the cached portion, so we
// subtract cachedContentTokenCount out of input (as tokz does for Codex).
function qwenRoot(home?: string): string {
  return process.env.QWEN_DATA_DIR ?? join(home ?? homedir(), ".qwen");
}

async function parseFile(file: string): Promise<SessionStats> {
  const records: UsageRecord[] = [];
  for (const line of await readJsonl(file)) {
    const meta = (line as { usageMetadata?: unknown }).usageMetadata;
    if (!meta) continue;
    const prompt = pickNum(meta, ["promptTokenCount"]);
    const cached = pickNum(meta, ["cachedContentTokenCount"]);
    const reasoning = pickNum(meta, ["thoughtsTokenCount"]);
    records.push({
      model: str(line, "model") ?? "qwen-unknown",
      ts: str(line, "timestamp"),
      input: Math.max(0, prompt - cached),
      output: pickNum(meta, ["candidatesTokenCount"]) + reasoning,
      cacheRead: cached,
      cacheWrite: 0,
    });
  }
  return sessionFromRecords(file, undefined, records);
}

export async function loadQwenProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files = await glob(["projects/**/*.jsonl"], { cwd: qwenRoot(home), absolute: true }).catch(
    () => [],
  );
  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Qwen sessions" });
    sessions.push(await parseFile(f));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Qwen sessions" });
  }
  return groupSessionsByCwd("qwen", sessions);
}

export const qwenAdapter: AgentAdapter = {
  id: "qwen",
  name: "Qwen Code",
  supported: true,
  async detect(home) {
    try {
      await access(join(qwenRoot(home), "projects"));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadQwenProjects,
};
