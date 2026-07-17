import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import { readTable } from "../sqlite.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, sessionFromRecords, str, toIso, type UsageRecord } from "./usage.js";

// Hermes: ~/.hermes/state.db SQLite. One row per session in `sessions` with
// input/output/cache/reasoning token columns and the model name inline.
function hermesDb(home?: string): string {
  const env = process.env.HERMES_HOME;
  const root = env ? env.split(",")[0].trim() : join(home ?? homedir(), ".hermes");
  return join(root, "state.db");
}

export async function loadHermesProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const rows = await readTable(hermesDb(home), "sessions").catch(() => []);
  const records: UsageRecord[] = [];
  for (const row of rows) {
    onProgress?.({ parsed: records.length, total: rows.length, currentProject: "Hermes sessions" });
    records.push({
      model: str(row, "model") ?? "hermes-unknown",
      ts: toIso(row.started_at),
      input: pickNum(row, ["input_tokens"]),
      output: pickNum(row, ["output_tokens"]) + pickNum(row, ["reasoning_tokens"]),
      cacheRead: pickNum(row, ["cache_read_tokens"]),
      cacheWrite: pickNum(row, ["cache_write_tokens"]),
    });
  }
  const session: SessionStats = sessionFromRecords("hermes", undefined, records);
  return groupSessionsByCwd("hermes", [session]);
}

export const hermesAdapter: AgentAdapter = {
  id: "hermes",
  name: "Hermes",
  supported: true,
  async detect(home) {
    try {
      await access(hermesDb(home));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadHermesProjects,
};
