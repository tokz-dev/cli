import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJson, sessionFromRecords, str, type UsageRecord } from "./usage.js";

// Codebuff (Manicode): ~/.config/{manicode,manicode-dev,manicode-staging}/
// projects/**/chat-messages.json — an array of messages; assistant ones carry
// metadata.usage. Token keys come in both camelCase and snake_case.
const CHANNELS = ["manicode", "manicode-dev", "manicode-staging"];

function codebuffRoots(home?: string): string[] {
  const env = process.env.CODEBUFF_DATA_DIR;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  const h = home ?? homedir();
  return CHANNELS.map((c) => join(h, ".config", c));
}

function isAssistant(msg: unknown): boolean {
  const role = str(msg, "variant") ?? str(msg, "role");
  return role === "ai" || role === "agent" || role === "assistant";
}

async function parseFile(file: string, seen: Set<string>): Promise<SessionStats> {
  const arr = await readJson(file);
  if (!Array.isArray(arr)) return sessionFromRecords(file, undefined, []);
  let fileTs: string | undefined;
  try {
    fileTs = (await stat(file)).mtime.toISOString();
  } catch {}
  const records: UsageRecord[] = [];
  for (const msg of arr) {
    if (!isAssistant(msg)) continue;
    const meta = (msg as { metadata?: unknown }).metadata;
    const usage = (meta as { usage?: unknown })?.usage;
    if (!usage) continue;
    records.push({
      model: str(meta, "model") ?? "codebuff-unknown",
      ts: str(msg, "timestamp") ?? fileTs,
      id: str(msg, "id") ?? str(msg, "messageId") ?? str(msg, "message_id"),
      input: pickNum(usage, ["inputTokens", "input_tokens"]),
      output: pickNum(usage, ["outputTokens", "output_tokens"]),
      cacheRead: pickNum(usage, ["cacheReadInputTokens", "cache_read_input_tokens", "cachedTokens"]),
      cacheWrite: pickNum(usage, ["cacheCreationInputTokens", "cache_creation_input_tokens"]),
    });
  }
  return sessionFromRecords(file, undefined, records);
}

export async function loadCodebuffProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files: string[] = [];
  for (const root of codebuffRoots(home)) {
    files.push(
      ...(await glob(["**/chat-messages.json"], { cwd: root, absolute: true }).catch(() => [])),
    );
  }
  const sessions: SessionStats[] = [];
  const seen = new Set<string>();
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Codebuff chats" });
    sessions.push(await parseFile(f, seen));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Codebuff chats" });
  }
  return groupSessionsByCwd("codebuff", sessions);
}

export const codebuffAdapter: AgentAdapter = {
  id: "codebuff",
  name: "Codebuff",
  supported: true,
  async detect(home) {
    for (const root of codebuffRoots(home)) {
      try {
        await access(root);
        return true;
      } catch {}
    }
    return false;
  },
  loadProjects: loadCodebuffProjects,
};
