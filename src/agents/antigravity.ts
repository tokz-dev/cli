import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { emptyUsage } from "../pricing.js";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";

// Antigravity stores no token counts on disk. Turns and models are real (from
// the conversation DB's generation-metadata records + history.jsonl); token
// counts are estimated from conversation text size, so the adapter is
// `estimated`. See scanConversation for the byte-level details.

const ESTIMATED_CHARS_PER_TOKEN = 4;
// Agent context (system prompt, files, tool results) dwarfs generated text;
// without real counts we attribute most estimated tokens to input.
const INPUT_SHARE = 0.85;

function antigravityRoot(home?: string): string {
  return join(home ?? homedir(), ".gemini", "antigravity-cli");
}

interface HistoryEntry {
  timestamp?: number;
  workspace?: string;
  conversationId?: string;
  type?: string;
}

/** "Gemini 3.1 Pro (High)" -> "gemini-3.1-pro"; "Claude Sonnet 4.6" -> "claude-sonnet-4-6" */
export function modelIdFromDisplayName(name: string): string {
  const bare = name.replace(/\s*\(.*\)\s*$/, "").trim();
  const slug = bare.toLowerCase().replace(/\s+/g, "-");
  return slug.startsWith("claude") ? slug.replace(/\./g, "-") : slug;
}

const MODEL_NAME_RX = /(Gemini|Claude|GPT)[- ][0-9][0-9A-Za-z. ]{0,25}(\((Low|Medium|High|Max|Thinking)\))?/;

export interface ConversationScan {
  /** display-name turn counts; "" key = metadata record with no readable name */
  turnsByModel: Record<string, number>;
  /** printable text volume of the whole database, in characters */
  textChars: number;
}

/** Scan a conversation .db's raw bytes for per-turn model markers and text volume. */
export function scanConversation(buf: Buffer): ConversationScan {
  const text = buf.toString("latin1");
  const turnsByModel: Record<string, number> = {};
  const anchor = /used_claude_conservative/g;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(text))) {
    const window = text.slice(m.index + 24, m.index + 250);
    const name = window.match(MODEL_NAME_RX);
    const key = name ? modelIdFromDisplayName(name[0]) : "";
    turnsByModel[key] = (turnsByModel[key] ?? 0) + 1;
  }
  let textChars = 0;
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const c = i < buf.length ? buf[i] : 0;
    const printable = c >= 32 && c < 127;
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      if (i - start >= 20) textChars += i - start;
      start = -1;
    }
  }
  return { turnsByModel, textChars };
}

async function readHistory(root: string): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(join(root, "history.jsonl"), "utf8");
    const out: HistoryEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as HistoryEntry);
      } catch {
        // skip malformed lines
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadAntigravityProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const root = antigravityRoot(home);
  const convDir = join(root, "conversations");
  let dbFiles: string[];
  try {
    dbFiles = (await readdir(convDir)).filter((f) => f.endsWith(".db"));
  } catch {
    return [];
  }
  if (dbFiles.length === 0) return [];

  const history = await readHistory(root);
  const byConversation = new Map<string, { workspace?: string; firstTs?: number; lastTs?: number }>();
  for (const e of history) {
    if (!e.conversationId || !e.timestamp) continue;
    const c = byConversation.get(e.conversationId) ?? {};
    c.workspace ??= e.workspace;
    if (!c.firstTs || e.timestamp < c.firstTs) c.firstTs = e.timestamp;
    if (!c.lastTs || e.timestamp > c.lastTs) c.lastTs = e.timestamp;
    byConversation.set(e.conversationId, c);
  }

  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const file of dbFiles) {
    onProgress?.({ parsed, total: dbFiles.length, currentProject: "Antigravity conversations" });
    let scan: ConversationScan;
    try {
      scan = scanConversation(await readFile(join(convDir, file)));
    } catch {
      parsed += 1;
      continue;
    }
    parsed += 1;
    onProgress?.({ parsed, total: dbFiles.length, currentProject: "Antigravity conversations" });

    // Attribute unlabeled metadata records to the conversation's dominant model.
    const named = Object.entries(scan.turnsByModel).filter(([k]) => k !== "");
    named.sort((a, b) => b[1] - a[1]);
    const fallback = named[0]?.[0] ?? "antigravity-unknown";
    const turnsByModel: Record<string, number> = {};
    for (const [model, turns] of Object.entries(scan.turnsByModel)) {
      const key = model === "" ? fallback : model;
      turnsByModel[key] = (turnsByModel[key] ?? 0) + turns;
    }
    const totalTurns = Object.values(turnsByModel).reduce((s, n) => s + n, 0);
    if (totalTurns === 0) continue;

    const conversationId = file.replace(/\.db$/, "");
    const meta = byConversation.get(conversationId);
    const firstTs = meta?.firstTs ? new Date(meta.firstTs).toISOString() : undefined;
    const lastTs = meta?.lastTs ? new Date(meta.lastTs).toISOString() : undefined;
    const day = (lastTs ?? firstTs)?.slice(0, 10);

    const estTokens = Math.round(scan.textChars / ESTIMATED_CHARS_PER_TOKEN);
    const stats: SessionStats = {
      file: conversationId,
      cwd: meta?.workspace,
      firstTs,
      lastTs,
      usageByModel: {},
      toolCalls: {},
      toolCostUsd: {},
      dailyUsage: {},
    };
    for (const [model, turns] of Object.entries(turnsByModel)) {
      const share = turns / totalTurns;
      const u = (stats.usageByModel[model] ??= emptyUsage());
      u.inputTokens += Math.round(estTokens * share * INPUT_SHARE);
      u.outputTokens += Math.round(estTokens * share * (1 - INPUT_SHARE));
      u.turns += turns;
      if (day) {
        const d = ((stats.dailyUsage[day] ??= {})[model] ??= emptyUsage());
        d.inputTokens += u.inputTokens;
        d.outputTokens += u.outputTokens;
        d.turns += turns;
      }
    }
    sessions.push(stats);
  }

  return groupSessionsByCwd("antigravity", sessions);
}

export const antigravityAdapter: AgentAdapter = {
  id: "antigravity",
  name: "Antigravity",
  supported: true,
  estimated: true,
  estimateNote: "no token counts on disk — tokens/costs estimated from conversation size",
  async detect(home) {
    try {
      await access(join(antigravityRoot(home), "conversations"));
      return true;
    } catch {
      try {
        await access(join(home ?? homedir(), ".gemini", "antigravity", "conversations"));
        return true;
      } catch {
        return false;
      }
    }
  },
  loadProjects: loadAntigravityProjects,
};
