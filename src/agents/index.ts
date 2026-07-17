import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadProgress } from "../projects.js";
import { antigravityAdapter } from "./antigravity.js";
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

// Antigravity stores no token counts on disk, so its adapter reports
// size-derived estimates (flagged as such in the UI). Cursor CLI stays
// detect-only: sessions live in SQLite we don't parse yet.
export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  antigravityAdapter,
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
