import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadProgress } from "../projects.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { opencodeAdapter } from "./opencode.js";
import type { AgentAdapter, AgentData } from "./types.js";

function detectOnly(
  id: string,
  name: string,
  reason: string,
  ...pathParts: string[]
): AgentAdapter {
  return {
    id,
    name,
    supported: false,
    unsupportedReason: reason,
    async detect(home = homedir()) {
      try {
        await access(join(home, ...pathParts));
        return true;
      } catch {
        return false;
      }
    },
    loadProjects: async () => [],
  };
}

// Detected but not parseable offline: Antigravity (formerly Gemini CLI's slot)
// stores conversations as binary protobuf with no token counts — usage is only
// reachable via the running editor's language-server RPC; Cursor CLI stores
// sessions in SQLite.
export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  detectOnly(
    "antigravity",
    "Antigravity",
    "no token usage stored on disk (binary protobuf sessions)",
    ".gemini",
    "antigravity",
    "conversations",
  ),
  detectOnly("cursor", "Cursor CLI", "sessions live in SQLite; parsing not supported yet", ".cursor", "chats"),
];

export async function loadAllAgents(
  home?: string,
  onProgress?: (agent: string, p: LoadProgress) => void,
): Promise<AgentData[]> {
  const out: AgentData[] = [];
  for (const adapter of ADAPTERS) {
    const detected = await adapter.detect(home);
    let projects: AgentData["projects"] = [];
    if (detected && adapter.supported) {
      projects = await adapter
        .loadProjects(home, (p) => onProgress?.(adapter.name, p))
        .catch(() => []);
    }
    out.push({ adapter, detected, projects });
  }
  return out;
}
