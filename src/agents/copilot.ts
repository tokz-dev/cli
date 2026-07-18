import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";
import { readJsonl, sessionFromRecords, toIso, type UsageRecord } from "./usage.js";

// GitHub Copilot CLI: ~/.copilot/otel/**/*.jsonl — OpenTelemetry records. Usage
// lives in each record's `attributes` under `gen_ai.usage.*` keys; model and
// session come from sibling attributes. Records repeat per span, so we dedup by
// response/span id.
function copilotDir(home?: string): string {
  return join(home ?? homedir(), ".copilot", "otel");
}

const MODEL_ATTRS = ["gen_ai.response.model", "gen_ai.request.model"];
const SESSION_ATTRS = [
  "gen_ai.conversation.id",
  "copilot_chat.session_id",
  "copilot_chat.chat_session_id",
  "session.id",
  "github.copilot.interaction_id",
  "gen_ai.response.id",
];

type Attrs = Record<string, unknown>;

/** OTel values are sometimes wrapped ({intValue}/{doubleValue}/{stringValue}). */
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return o.intValue ?? o.doubleValue ?? o.stringValue ?? o.value ?? v;
  }
  return v;
}

function attrNum(attrs: Attrs, key: string): number {
  const v = unwrap(attrs[key]);
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function attrStr(attrs: Attrs, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = unwrap(attrs[k]);
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

export function parseOtelFile(records: unknown[]): Map<string, UsageRecord[]> {
  const bySession = new Map<string, UsageRecord[]>();
  const seen = new Set<string>();
  for (const rec of records) {
    const attrs = (rec as { attributes?: Attrs }).attributes;
    if (!attrs || typeof attrs !== "object") continue;
    const input = attrNum(attrs, "gen_ai.usage.input_tokens");
    const output = attrNum(attrs, "gen_ai.usage.output_tokens");
    const cacheRead = attrNum(attrs, "gen_ai.usage.cache_read.input_tokens");
    const cacheWrite =
      attrNum(attrs, "gen_ai.usage.cache_write.input_tokens") ||
      attrNum(attrs, "gen_ai.usage.cache_creation.input_tokens");
    const reasoning =
      attrNum(attrs, "gen_ai.usage.reasoning.output_tokens") ||
      attrNum(attrs, "gen_ai.usage.reasoning_tokens");
    if (input + output + cacheRead + cacheWrite === 0) continue;

    const session = attrStr(attrs, SESSION_ATTRS) ?? "copilot";
    // dedup the same inference reported by multiple spans/logs
    const r = rec as { spanId?: unknown; timestamp?: unknown; startTime?: unknown };
    const dedup =
      attrStr(attrs, ["gen_ai.response.id"]) ??
      `${String(unwrap(r.spanId) ?? "")}:${session}:${input}:${output}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    const list = bySession.get(session) ?? [];
    list.push({
      model: attrStr(attrs, MODEL_ATTRS) ?? "copilot-unknown",
      ts: toIso(r.timestamp as string) ?? toIso(r.startTime as string),
      input,
      output: output + reasoning,
      cacheRead,
      cacheWrite,
    });
    bySession.set(session, list);
  }
  return bySession;
}

export async function loadCopilotProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const files = await glob(["**/*.jsonl"], { cwd: copilotDir(home), absolute: true }).catch(() => []);
  const bySession = new Map<string, UsageRecord[]>();
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Copilot otel" });
    for (const [session, records] of parseOtelFile(await readJsonl(f))) {
      const list = bySession.get(session) ?? [];
      list.push(...records);
      bySession.set(session, list);
    }
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Copilot otel" });
  }
  const sessions: SessionStats[] = [];
  for (const [id, records] of bySession) sessions.push(sessionFromRecords(id, undefined, records));
  return groupSessionsByCwd("copilot", sessions);
}

export const copilotAdapter: AgentAdapter = {
  id: "copilot",
  name: "GitHub Copilot CLI",
  supported: true,
  async detect(home) {
    try {
      await access(copilotDir(home));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadCopilotProjects,
};
