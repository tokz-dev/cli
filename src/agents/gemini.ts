import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { pickNum, readJson, readJsonl, sessionFromRecords, str, type UsageRecord } from "./usage.js";

// Gemini CLI: ~/.gemini/tmp/**/*.{json,jsonl}. Usage sits in a `tokens` object
// whose keys vary (input|prompt, output|candidates, cached, thoughts). Files
// come as JSONL logs or a single JSON doc with a `messages` array.
function geminiRoot(home?: string): string {
  return process.env.GEMINI_DATA_DIR ?? join(home ?? homedir(), ".gemini", "tmp");
}

const IN = ["input", "prompt", "input_tokens", "prompt_tokens"];
const OUT = ["output", "candidates", "output_tokens", "candidates_tokens"];

function recordFrom(node: unknown, model: string | undefined, ts: string | undefined): UsageRecord | undefined {
  const tokens = (node as { tokens?: unknown }).tokens;
  if (!tokens) return undefined;
  const reasoning = pickNum(tokens, ["thoughts", "reasoning", "thoughts_tokens", "reasoning_tokens"]);
  return {
    model: str(node, "model") ?? model ?? "gemini-unknown",
    ts: str(node, "timestamp") ?? ts,
    input: pickNum(tokens, IN),
    output: pickNum(tokens, OUT) + reasoning,
    cacheRead: pickNum(tokens, ["cached", "cached_tokens"]),
    cacheWrite: 0,
  };
}

async function parseFile(file: string): Promise<SessionStats> {
  const records: UsageRecord[] = [];
  const push = (r: UsageRecord | undefined) => r && records.push(r);
  if (file.endsWith(".jsonl")) {
    for (const line of await readJsonl(file)) push(recordFrom(line, str(line, "model"), undefined));
  } else {
    const doc = await readJson(file);
    const model = str(doc, "model");
    const messages = (doc as { messages?: unknown })?.messages;
    if (Array.isArray(messages)) for (const m of messages) push(recordFrom(m, model, undefined));
    push(recordFrom(doc, model, undefined));
  }
  return sessionFromRecords(file, undefined, records);
}

export async function loadGeminiProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files = await glob(["**/*.json", "**/*.jsonl"], { cwd: geminiRoot(home), absolute: true }).catch(
    () => [],
  );
  const sessions: SessionStats[] = [];
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Gemini logs" });
    sessions.push(await parseFile(f));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Gemini logs" });
  }
  return groupSessionsByCwd("gemini", sessions);
}

export const geminiAdapter: AgentAdapter = {
  id: "gemini",
  name: "Gemini CLI",
  supported: true,
  async detect(home) {
    try {
      await access(geminiRoot(home));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadGeminiProjects,
};
