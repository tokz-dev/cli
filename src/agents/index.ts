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
  piAdapter,
  antigravityAdapter,
  // Detected but not parsed yet: Goose/Hermes keep usage in SQLite tables we
  // haven't mapped (the reader exists in sqlite.ts — just needs their schema),
  // Copilot uses OpenTelemetry spans, Amp a usage ledger, Cursor SQLite.
  detectOnly("goose", "Goose", "SQLite schema (sessions.db) not mapped yet", [".local", "share", "goose", "sessions", "sessions.db"], ["Library", "Application Support", "goose", "sessions", "sessions.db"]),
  detectOnly("hermes", "Hermes", "SQLite schema (state.db) not mapped yet", [".hermes", "state.db"]),
  detectOnly("copilot", "GitHub Copilot CLI", "usage is OpenTelemetry spans — parsing not wired yet", [".copilot", "otel"]),
  detectOnly("amp", "Amp", "usage-ledger thread format — parsing not wired yet", [".local", "share", "amp"]),
  detectOnly("cursor", "Cursor CLI", "sessions live in SQLite; parsing not supported yet", [".cursor", "chats"]),
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
