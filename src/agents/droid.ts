import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJson, sessionFromRecords, str } from "./usage.js";

// Droid (Factory): ~/.factory/sessions/**/*.settings.json, one cumulative
// `tokenUsage` object per session file.
function droidRoot(home?: string): string {
  return process.env.DROID_SESSIONS_DIR ?? join(home ?? homedir(), ".factory", "sessions");
}

async function parseFile(file: string): Promise<SessionStats> {
  const settings = await readJson(file);
  const usage = (settings as { tokenUsage?: unknown })?.tokenUsage;
  if (!usage) return sessionFromRecords(file, undefined, []);
  let ts = str(settings, "updatedAt") ?? str(settings, "createdAt");
  if (!ts) {
    try {
      ts = (await stat(file)).mtime.toISOString();
    } catch {}
  }
  return sessionFromRecords(file, undefined, [
    {
      model: str(settings, "model") ?? "droid-unknown",
      ts,
      input: pickNum(usage, ["inputTokens"]),
      output: pickNum(usage, ["outputTokens"]) + pickNum(usage, ["thinkingTokens"]),
      cacheRead: pickNum(usage, ["cacheReadTokens"]),
      cacheWrite: pickNum(usage, ["cacheCreationTokens"]),
    },
  ]);
}

export async function loadDroidProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files = (
    await glob(["**/*.settings.json"], { cwd: droidRoot(home), absolute: true }).catch(() => [])
  ).filter((f) => basename(f).endsWith(".settings.json"));
  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Droid sessions" });
    sessions.push(await parseFile(f));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Droid sessions" });
  }
  return groupSessionsByCwd("droid", sessions);
}

export const droidAdapter: AgentAdapter = {
  id: "droid",
  name: "Droid (Factory)",
  supported: true,
  async detect(home) {
    try {
      await access(droidRoot(home));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadDroidProjects,
};
