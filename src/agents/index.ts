import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LoadProgress } from "../projects.js";
import { ampAdapter } from "./amp.js";
import { antigravityAdapter } from "./antigravity.js";
import { claudeAdapter } from "./claude.js";
import { codebuffAdapter } from "./codebuff.js";
import { codexAdapter } from "./codex.js";
import { copilotAdapter } from "./copilot.js";
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
        } catch {}
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
// shows up with a reason, like Copilot/Amp below.
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
  copilotAdapter,
  ampAdapter,
  piAdapter,
  antigravityAdapter,
  // Cursor keeps no token counts on disk (usage is server-side, reachable only
  // with auth), so there's nothing to parse offline — surfaced with the reason.
  detectOnly("cursor", "Cursor", "no token counts stored locally — usage is server-side", [".cursor"]),
];

/** Resolve a CLI target to an agent: by id ("codex") or display name ("claude code"). */
export function findAdapter(target: string): AgentAdapter | undefined {
  const key = target.trim().toLowerCase();
  return ADAPTERS.find((a) => a.id === key || a.name.toLowerCase() === key);
}

export async function loadAllAgents(
  home?: string,
  onProgress?: (agent: string, p: LoadProgress) => void,
): Promise<AgentData[]> {
  // Adapters are independent (no shared state), so detect + load them all
  // concurrently. Order of ADAPTERS is preserved for the picker.
  return Promise.all(
    ADAPTERS.map(async (adapter): Promise<AgentData> => {
      const detected = await adapter.detect(home).catch(() => false);
      let projects: AgentData["projects"] = [];
      if (detected && adapter.supported) {
        projects = await adapter.loadProjects(home, (p) => onProgress?.(adapter.name, p)).catch(() => []);
      }
      return { adapter, detected, projects };
    }),
  );
}
