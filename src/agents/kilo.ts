import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import { readTable } from "../sqlite.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { sessionFromRecords, type UsageRecord } from "./usage.js";

// Kilo: ~/.local/share/kilo/kilo.db (SQLite). The `message` table stores one
// OpenCode-shaped JSON blob per row in its `data` column. Read via tokz's
// pure-JS SQLite reader (no native dep, so `npx` still works), grouped by the
// session id inside each message.
function kiloDir(home?: string): string {
  return process.env.KILO_DATA_DIR ?? join(home ?? homedir(), ".local", "share", "kilo");
}

interface KiloMessage {
  role?: string;
  modelID?: string;
  sessionID?: string;
  time?: { created?: number };
  tokens?: { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } };
}

export async function loadKiloProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const db = join(kiloDir(home), "kilo.db");
  let rows: Awaited<ReturnType<typeof readTable>>;
  try {
    rows = await readTable(db, "message");
  } catch {
    return [];
  }

  // One SessionStats per session id, accumulated from its assistant messages.
  const bySession = new Map<string, UsageRecord[]>();
  let parsed = 0;
  for (const row of rows) {
    onProgress?.({ parsed, total: rows.length, currentProject: "Kilo messages" });
    parsed += 1;
    if (typeof row.data !== "string") continue;
    let m: KiloMessage;
    try {
      m = JSON.parse(row.data) as KiloMessage;
    } catch {
      continue;
    }
    if (m.role !== "assistant" || !m.tokens) continue;
    const session = m.sessionID ?? String(row.session_id ?? "kilo");
    const list = bySession.get(session) ?? [];
    list.push({
      model: m.modelID ?? "kilo-unknown",
      ts: m.time?.created ? new Date(m.time.created).toISOString() : undefined,
      input: m.tokens.input ?? 0,
      output: (m.tokens.output ?? 0) + (m.tokens.reasoning ?? 0),
      cacheRead: m.tokens.cache?.read ?? 0,
      cacheWrite: m.tokens.cache?.write ?? 0,
    });
    bySession.set(session, list);
  }

  const sessions: SessionStats[] = [];
  for (const [id, records] of bySession) sessions.push(sessionFromRecords(id, undefined, records));
  return groupSessionsByCwd("kilo", sessions);
}

export const kiloAdapter: AgentAdapter = {
  id: "kilo",
  name: "Kilo",
  supported: true,
  async detect(home) {
    try {
      await access(join(kiloDir(home), "kilo.db"));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadKiloProjects,
};
