import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJsonl, sessionFromRecords, str, type UsageRecord } from "./usage.js";

// pi-agent: ~/.pi/agent/sessions/**/*.jsonl. Each usage line nests
// message.usage {input, output, cacheRead, cacheWrite}.
function piRoot(home?: string): string {
  return process.env.PI_AGENT_DIR ?? join(home ?? homedir(), ".pi", "agent", "sessions");
}

async function parseFile(file: string, seen: Set<string>): Promise<SessionStats> {
  const records: UsageRecord[] = [];
  for (const line of await readJsonl(file)) {
    const msg = (line as { message?: unknown }).message;
    const usage = (msg as { usage?: unknown })?.usage;
    if (!usage) continue;
    records.push({
      model: str(msg, "model") ?? "pi-unknown",
      ts: str(line, "timestamp"),
      id: str(msg, "id") ?? str(line, "id") ?? str(msg, "messageId"),
      input: pickNum(usage, ["input"]),
      output: pickNum(usage, ["output"]),
      cacheRead: pickNum(usage, ["cacheRead"]),
      cacheWrite: pickNum(usage, ["cacheWrite"]),
    });
  }
  return sessionFromRecords(file, undefined, records, seen);
}

export async function loadPiProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files = await glob(["**/*.jsonl"], { cwd: piRoot(home), absolute: true }).catch(() => []);
  const sessions: SessionStats[] = [];
  const seen = new Set<string>();
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "pi sessions" });
    sessions.push(await parseFile(f, seen));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "pi sessions" });
  }
  return groupSessionsByCwd("pi", sessions);
}

export const piAdapter: AgentAdapter = {
  id: "pi",
  name: "pi-agent",
  supported: true,
  async detect(home) {
    try {
      await access(piRoot(home));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadPiProjects,
};
