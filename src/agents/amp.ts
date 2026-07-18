import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJson, sessionFromRecords, str, toIso, type UsageRecord } from "./usage.js";

// Amp: ~/.local/share/amp/threads/**/*.json. Each thread is one JSON object
// with a `messages` array and an optional `usageLedger.events` array. When the
// ledger is present it's authoritative for input/output (cache tokens are
// looked up from the referenced message); otherwise per-message `usage` is used.
function ampRoot(home?: string): string {
  const env = process.env.AMP_DATA_DIR;
  return env ? env.split(",")[0].trim() : join(home ?? homedir(), ".local", "share", "amp");
}

interface AmpMessage {
  role?: string;
  model?: string;
  messageId?: number;
  timestamp?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

function parseThread(thread: unknown): UsageRecord[] {
  const messages = (thread as { messages?: AmpMessage[] })?.messages ?? [];
  const events = (thread as { usageLedger?: { events?: unknown[] } })?.usageLedger?.events;
  const records: UsageRecord[] = [];

  if (Array.isArray(events)) {
    // cache tokens keyed by the message the ledger event points at
    const cacheByMsg = new Map<number, { cw: number; cr: number }>();
    for (const m of messages) {
      if (typeof m.messageId === "number" && m.usage) {
        cacheByMsg.set(m.messageId, {
          cw: m.usage.cacheCreationInputTokens ?? 0,
          cr: m.usage.cacheReadInputTokens ?? 0,
        });
      }
    }
    for (const e of events) {
      const tokens = (e as { tokens?: unknown }).tokens;
      const toMsg = (e as { toMessageId?: number }).toMessageId;
      const cache = typeof toMsg === "number" ? cacheByMsg.get(toMsg) : undefined;
      records.push({
        model: str(e, "model") ?? "amp-unknown",
        ts: toIso(str(e, "timestamp")),
        input: pickNum(tokens, ["input"]),
        output: pickNum(tokens, ["output"]),
        cacheRead: cache?.cr ?? 0,
        cacheWrite: cache?.cw ?? 0,
      });
    }
    return records;
  }

  for (const m of messages) {
    if (m.role !== "assistant" || !m.usage) continue;
    records.push({
      model: m.model ?? "amp-unknown",
      ts: toIso(m.timestamp),
      input: m.usage.inputTokens ?? 0,
      output: m.usage.outputTokens ?? 0,
      cacheRead: m.usage.cacheReadInputTokens ?? 0,
      cacheWrite: m.usage.cacheCreationInputTokens ?? 0,
    });
  }
  return records;
}

export async function loadAmpProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files = await glob(["threads/**/*.json"], { cwd: ampRoot(home), absolute: true }).catch(
    () => [],
  );
  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Amp threads" });
    const thread = await readJson(f);
    const id = str(thread, "id") ?? f;
    sessions.push(sessionFromRecords(id, undefined, parseThread(thread)));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Amp threads" });
  }
  return groupSessionsByCwd("amp", sessions);
}

export const ampAdapter: AgentAdapter = {
  id: "amp",
  name: "Amp",
  supported: true,
  async detect(home) {
    try {
      await access(join(ampRoot(home), "threads"));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadAmpProjects,
};
