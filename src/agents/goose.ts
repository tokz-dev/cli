import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import { readTable } from "../sqlite.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, sessionFromRecords, toIso, type UsageRecord } from "./usage.js";

// Goose (Block): sessions.db SQLite. One row per session in `sessions`, with
// cumulative token counts and the model inside model_config_json. No cache
// tokens are recorded. Read with tokz's pure-JS SQLite reader.
const GOOSE_DB_CANDIDATES = [
  [".local", "share", "goose", "sessions", "sessions.db"],
  ["Library", "Application Support", "goose", "sessions", "sessions.db"],
  [".local", "share", "Block", "goose", "sessions", "sessions.db"],
];

function gooseDbCandidates(home?: string): string[] {
  const root = process.env.GOOSE_PATH_ROOT;
  if (root) return [join(root, "data", "sessions", "sessions.db")];
  const h = home ?? homedir();
  return GOOSE_DB_CANDIDATES.map((parts) => join(h, ...parts));
}

export async function loadGooseProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const records: UsageRecord[] = [];
  for (const db of gooseDbCandidates(home)) {
    const rows = await readTable(db, "sessions").catch(() => []);
    for (const row of rows) {
      onProgress?.({ parsed: records.length, total: rows.length, currentProject: "Goose sessions" });
      // prefer accumulated (lifetime) counts, fall back to per-turn
      const input = pickNum(row, ["accumulated_input_tokens"]) || pickNum(row, ["input_tokens"]);
      const output = pickNum(row, ["accumulated_output_tokens"]) || pickNum(row, ["output_tokens"]);
      const total = pickNum(row, ["accumulated_total_tokens"]) || pickNum(row, ["total_tokens"]);
      const reasoning = Math.max(0, total - input - output);
      let model = "goose-unknown";
      try {
        model = (JSON.parse(String(row.model_config_json ?? "{}")).model_name as string) || model;
      } catch {
        // keep default
      }
      records.push({
        model,
        ts: toIso(row.created_at),
        input,
        output: output + reasoning,
        cacheRead: 0,
        cacheWrite: 0,
      });
    }
  }
  const session: SessionStats = sessionFromRecords("goose", undefined, records);
  return groupSessionsByCwd("goose", [session]);
}


export const gooseAdapter: AgentAdapter = {
  id: "goose",
  name: "Goose",
  supported: true,
  async detect(home) {
    for (const db of gooseDbCandidates(home)) {
      try {
        await access(db);
        return true;
      } catch {
        // try next
      }
    }
    return false;
  },
  loadProjects: loadGooseProjects,
};
