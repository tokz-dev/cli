import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadProgress } from "../projects.js";
import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { opencodeAdapter } from "./opencode.js";
import type { AgentAdapter, AgentData } from "./types.js";

function detectOnly(id: string, name: string, ...pathParts: string[]): AgentAdapter {
  return {
    id,
    name,
    supported: false,
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

// Detected but not yet parsed: Gemini CLI keeps chat checkpoints without token
// usage; Cursor CLI stores sessions in SQLite.
export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  detectOnly("gemini", "Gemini CLI", ".gemini", "tmp"),
  detectOnly("cursor", "Cursor CLI", ".cursor", "chats"),
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
