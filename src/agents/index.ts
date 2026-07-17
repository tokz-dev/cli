import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadProgress } from "../projects.js";
import { antigravityAdapter } from "./antigravity.js";
import { claudeAdapter } from "./claude.js";
import { codebuffAdapter } from "./codebuff.js";
import { codexAdapter } from "./codex.js";
import { droidAdapter } from "./droid.js";
import { geminiAdapter } from "./gemini.js";
import { gooseAdapter } from "./goose.js";
import { hermesAdapter } from "./hermes.js";
import { kiloAdapter } from "./kilo.js";
import { kimiAdapter } from "./kimi.js";
import { openclawAdapter } from "./openclaw.js";
import { opencodeAdapter } from "./opencode.js";
import { piAdapter } from "./pi.js";
import { qwenAdapter } from "./qwen.js";
import type { AgentAdapter, AgentData } from "./types.js";

function detectOnly(
  id: string,
  name: string,
  reason: string,
  ...pathCandidates: string[][]
): AgentAdapter {
  return {
    id,
    name,
    supported: false,
    unsupportedReason: reason,
    async detect(home = homedir()) {
      for (const parts of pathCandidates) {
        try {
          await access(join(home, ...parts));
          return true;
        } catch {
          // try next candidate
        }
      }
      return false;
    },
    loadProjects: async () => [],
  };
}

// The registry of every agent tokz knows about. To ADD an agent: write an
// AgentAdapter (see codex.ts for a full parser — parse each session into a
// SessionStats, then `groupSessionsByCwd(id, sessions)`) and list it here. If
// its local data has no usable token counts, use detectOnly() so it still
// shows up with a reason, like Cursor below.
//
// Antigravity is `supported` but flagged `estimated`: it has no token counts on
// disk, so its adapter derives them from conversation size (see antigravity.ts).
export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  codexAdapter,
  opencodeAdapter,
  geminiAdapter,
  qwenAdapter,
  droidAdapter,
  codebuffAdapter,
  openclawAdapter,
  kimiAdapter,
  kiloAdapter,
  gooseAdapter,
  hermesAdapter,
  piAdapter,
  antigravityAdapter,
  // Detected but not parsed: Copilot uses OpenTelemetry spans, Amp a usage
  // ledger (formats not wired yet). Cursor keeps no token counts in its local
  // SQLite — usage is server-side — so there is nothing to parse offline.
  detectOnly("copilot", "GitHub Copilot CLI", "usage is OpenTelemetry spans — parsing not wired yet", [".copilot", "otel"]),
  detectOnly("amp", "Amp", "usage-ledger thread format — parsing not wired yet", [".local", "share", "amp"]),
  detectOnly("cursor", "Cursor", "no token counts stored locally — usage is server-side", [".cursor"]),
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
