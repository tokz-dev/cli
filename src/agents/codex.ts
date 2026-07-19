import { access, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { glob } from "tinyglobby";
import { costUsd, emptyUsage } from "../pricing.js";
import { groupSessionsByCwd, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats, UsageTotals } from "../types.js";
import type { AgentAdapter } from "./types.js";

const DEFAULT_MODEL = "gpt-5";
const CODEX_AUTO_REVIEW_MODEL = "codex-auto-review";

/**
 * When a rollout logs the pseudo-model `codex-auto-review`, map it to the real
 * model that powered auto-review on that date (models.dev snapshot).
 * Sorted newest-first; the first entry whose release date is <= the event date
 * wins.
 */
const CODEX_AUTO_REVIEW_FALLBACKS: ReadonlyArray<{ releasedOn: string; model: string }> = [
  { releasedOn: "2026-04-23", model: "gpt-5.5" },
  { releasedOn: "2026-03-05", model: "gpt-5.4" },
  { releasedOn: "2026-02-05", model: "gpt-5.3-codex" },
  { releasedOn: "2025-12-11", model: "gpt-5.2-codex" },
  { releasedOn: "2025-11-13", model: "gpt-5.1-codex" },
  { releasedOn: "2025-09-15", model: "gpt-5-codex" },
  { releasedOn: "2025-08-07", model: "gpt-5" },
];

function codexHomes(home?: string): string[] {
  if (home) return [join(home, ".codex")];
  const env = process.env.CODEX_HOME;
  if (env) {
    return env
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  return [join(homedir(), ".codex")];
}

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Dict) : undefined;
}

/** Lossy u64: non-negative integers pass; numeric strings parse; else absent. */
function u64(v: unknown): number | undefined {
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 0 ? v : undefined;
  }
  if (typeof v === "string") {
    const t = v.trim();
    return /^\d+$/.test(t) ? Number(t) : undefined;
  }
  return undefined;
}

interface RawUsage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}

/**
 * Normalize a usage object across every field spelling Codex has used:
 * `input_tokens`/`prompt_tokens`/`input`, `cached_input_tokens`/
 * `cache_read_input_tokens`/`cached_tokens`, `output_tokens`/
 * `completion_tokens`/`output`, `reasoning_output_tokens`/`reasoning_tokens`.
 * `total_tokens` is trusted only when positive (or when everything is zero);
 * otherwise it is recomputed as input + output + reasoning.
 */
function rawUsage(v: unknown): RawUsage | undefined {
  const o = asDict(v);
  if (!o) return undefined;
  const input = u64(o.input_tokens) ?? u64(o.prompt_tokens) ?? u64(o.input) ?? 0;
  const cached = u64(o.cached_input_tokens) ?? u64(o.cache_read_input_tokens) ?? u64(o.cached_tokens) ?? 0;
  const output = u64(o.output_tokens) ?? u64(o.completion_tokens) ?? u64(o.output) ?? 0;
  const reasoning = u64(o.reasoning_output_tokens) ?? u64(o.reasoning_tokens) ?? 0;
  const sum = input + output + reasoning;
  const totalField = u64(o.total_tokens);
  const total = totalField !== undefined && (totalField > 0 || sum === 0) ? totalField : sum;
  return { input, cached, output, reasoning, total };
}

function subtractUsage(current: RawUsage, previous: RawUsage | undefined): RawUsage {
  return {
    input: Math.max(0, current.input - (previous?.input ?? 0)),
    cached: Math.max(0, current.cached - (previous?.cached ?? 0)),
    output: Math.max(0, current.output - (previous?.output ?? 0)),
    reasoning: Math.max(0, current.reasoning - (previous?.reasoning ?? 0)),
    total: Math.max(0, current.total - (previous?.total ?? 0)),
  };
}

function nonEmpty(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Model from a payload/info/result-shaped object: model | model_name | metadata.model. */
function modelFromParts(v: unknown): string | undefined {
  const o = asDict(v);
  if (!o) return undefined;
  return nonEmpty(o.model) ?? nonEmpty(o.model_name) ?? nonEmpty(asDict(o.metadata)?.model);
}

/** Strict YYYY-MM-DD prefix validation (incl. month lengths and leap years). */
function timestampDate(ts: string): string | undefined {
  const date = ts.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const daysInMonth =
    month === 2
      ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
        ? 29
        : 28
      : [1, 3, 5, 7, 8, 10, 12].includes(month)
        ? 31
        : [4, 6, 9, 11].includes(month)
          ? 30
          : undefined;
  if (daysInMonth === undefined || day < 1 || day > daysInMonth) return undefined;
  return date;
}

function autoReviewFallback(model: string, timestamp: string): string | undefined {
  if (model !== CODEX_AUTO_REVIEW_MODEL) return undefined;
  const date = timestampDate(timestamp);
  if (!date) return DEFAULT_MODEL;
  return CODEX_AUTO_REVIEW_FALLBACKS.find((f) => date >= f.releasedOn)?.model ?? DEFAULT_MODEL;
}

interface ModelState {
  current?: string;
  currentIsFallback: boolean;
}

/**
 * Resolve the model for one usage event: an explicit model on the event wins
 * and updates the sticky per-file model; otherwise the sticky model applies;
 * otherwise fall back to gpt-5. `codex-auto-review` is mapped to the dated
 * real model.
 */
function resolveModel(parsed: string | undefined, timestamp: string, state: ModelState): string {
  if (parsed !== undefined) {
    state.current = parsed;
    state.currentIsFallback = false;
  }
  let model = parsed ?? state.current;
  if (model === undefined) {
    state.currentIsFallback = true;
    state.current = DEFAULT_MODEL;
    model = DEFAULT_MODEL;
  }
  return autoReviewFallback(model, timestamp) ?? model;
}

/** Normalize a timestamp value: ISO-ish strings pass through Date.parse; epoch numbers detect s vs ms. */
function normalizeTimestamp(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length === 0) return undefined;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  const raw = u64(v);
  if (raw === undefined) return undefined;
  const ms = raw > 10_000_000_000 ? raw : raw * 1000;
  return new Date(ms).toISOString();
}

/** Keep a well-formed raw timestamp string verbatim; otherwise normalize; otherwise undefined. */
function rawOrNormalizedTimestamp(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    if (t.length === 0) return undefined;
    if (timestampDate(t) !== undefined) return t;
    return normalizeTimestamp(t);
  }
  return normalizeTimestamp(v);
}

interface ParsedLine {
  timestamp?: string;
  type?: string;
  cwd?: string;
  payload?: Dict;
  obj: Dict;
}

function parseLine(raw: string): ParsedLine | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const o = asDict(obj);
  if (!o) return undefined;
  return {
    timestamp: typeof o.timestamp === "string" ? o.timestamp : undefined,
    type: typeof o.type === "string" ? o.type : undefined,
    cwd: typeof o.cwd === "string" ? o.cwd : undefined,
    payload: asDict(o.payload),
    obj: o,
  };
}

function tokenCountInfo(p: ParsedLine): Dict | undefined {
  return p.type === "event_msg" && p.payload?.type === "token_count"
    ? asDict(p.payload.info)
    : undefined;
}

/** Usage object for headless `codex exec` log lines: root or data/result/response. */
function headlessUsage(o: Dict): RawUsage | undefined {
  const usage =
    rawUsage(asDict(o.usage)) ??
    rawUsage(asDict(asDict(o.data)?.usage)) ??
    rawUsage(asDict(asDict(o.result)?.usage)) ??
    rawUsage(asDict(asDict(o.response)?.usage));
  if (!usage) return undefined;
  if (
    usage.input === 0 &&
    usage.cached === 0 &&
    usage.output === 0 &&
    usage.reasoning === 0 &&
    usage.total === 0
  ) {
    return undefined;
  }
  return usage;
}

function headlessModel(o: Dict): string | undefined {
  return (
    modelFromParts(o) ??
    modelFromParts(asDict(o.data)) ??
    modelFromParts(asDict(o.result)) ??
    modelFromParts(asDict(o.response))
  );
}

function headlessTimestamp(
  o: Dict,
  pick: (v: unknown) => string | undefined,
): string | undefined {
  const fromFields = (f: Dict | undefined) =>
    f ? (pick(f.timestamp) ?? pick(f.created_at) ?? pick(f.createdAt)) : undefined;
  return (
    fromFields(o) ??
    fromFields(asDict(o.data)) ??
    fromFields(asDict(o.result)) ??
    fromFields(asDict(o.response))
  );
}

/**
 * Parse one Codex rollout file:
 *
 * - Usage comes from `event_msg`/`token_count` events: `last_token_usage` when
 *   present, else the per-field positive delta between consecutive cumulative
 *   `total_token_usage` snapshots.
 * - Events where input, cached, output, and reasoning are all zero are skipped.
 * - `cached_input_tokens` is clamped to `input_tokens` (cached is a subset).
 * - The model comes from `turn_context` events (model | model_name |
 *   metadata.model), or from fields on the token_count payload/info; files
 *   without any model metadata fall back to `gpt-5`, and the pseudo-model
 *   `codex-auto-review` maps to the dated real model.
 * - Forked/resumed sessions replay the parent's token_count events verbatim;
 *   `seen` dedups these replayed events across files by their (timestamp,
 *   model, per-turn token) identity — no burst-skip heuristic needed.
 * - Headless `codex exec` log lines carrying a `usage` object (at the root or
 *   under data/result/response) are counted as standalone events.
 */
function detectReplaySecond(content: string, lines: ParsedLine[]): string | undefined {
  // ccusage literally reads the first 16 * 1024 bytes (not characters). If there are multi-byte
  // characters, a JS substring of 16384 can extend past 16384 bytes. We MUST match ccusage's
  // exact byte cutoff to match its logic (and its bugs).
  const encoder = new TextEncoder();
  let byteLen = 0;
  let charLimit = 0;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    // Rough fast byte length calculation for UTF-8
    if (code <= 0x7f) byteLen += 1;
    else if (code <= 0x7ff) byteLen += 2;
    else if (code >= 0xd800 && code <= 0xdfff) { byteLen += 4; i++; } // Surrogate pair
    else byteLen += 3;
    if (byteLen > 16384) break;
    charLimit = i + 1;
  }
  
  const head = content.slice(0, charLimit);
  if (!head.includes("thread_spawn") && !head.includes("forked_from_id")) return undefined;

  let firstSecond: string | undefined;
  for (const p of lines) {
    if (p.type !== "event_msg" || p.payload?.type !== "token_count") continue;
    const info = p.payload.info;
    if (!info) continue;
    if (!asDict(info.last_token_usage) && !asDict(info.total_token_usage)) continue;
    const ts = p.timestamp;
    if (!ts || typeof ts !== "string" || ts.length < 19) continue;
    const sec = ts.slice(0, 19);
    
    if (firstSecond === undefined) {
      firstSecond = sec;
    } else {
      if (firstSecond === sec) {
        return sec;
      }
      return undefined;
    }
  }
  return undefined;
}

export async function parseCodexRollout(
  file: string,
  seen: Set<string> = new Set(),
): Promise<SessionStats> {
  const stats: SessionStats = { file, usageByModel: {}, toolCalls: {}, toolCostUsd: {}, dailyUsage: {} };

  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  const lines: ParsedLine[] = [];
  let bytesRead = 0;
  let hasMarker = false;

  try {
    for await (const raw of rl) {
      if (bytesRead <= 16384) {
        if (raw.includes("thread_spawn") || raw.includes("forked_from_id")) {
          hasMarker = true;
        }
        bytesRead += Buffer.byteLength(raw, "utf8") + 1; // +1 for newline approximation
      }

      if (!raw.trim()) continue;
      const parsed = parseLine(raw);
      if (parsed) lines.push(parsed);
    }
  } catch (e) {
    // Ignore read errors
  }

  let replaySecond: string | undefined;
  if (hasMarker) {
    let firstSecond: string | undefined;
    for (const p of lines) {
      if (p.type !== "event_msg" || p.payload?.type !== "token_count") continue;
      const info = p.payload.info;
      if (!info) continue;
      if (!asDict(info.last_token_usage) && !asDict(info.total_token_usage)) continue;
      const ts = p.timestamp;
      if (!ts || typeof ts !== "string" || ts.length < 19) continue;
      const sec = ts.slice(0, 19);

      if (firstSecond === undefined) {
        firstSecond = sec;
      } else {
        if (firstSecond === sec) {
          replaySecond = sec;
        }
        break;
      }
    }
  }

  let skipReplay = replaySecond !== undefined;

  const modelState: ModelState = { currentIsFallback: false };
  let prev: RawUsage | undefined;
  let turnTools: string[] = [];
  let mtimeIso: string | undefined;

  const fileMtime = async (): Promise<string> => {
    if (mtimeIso === undefined) {
      mtimeIso = await stat(file)
        .then((s) => s.mtime.toISOString())
        .catch(() => new Date(0).toISOString());
    }
    return mtimeIso;
  };

  const accumulate = (usage: RawUsage, model: string, timestamp: string | undefined) => {
    const cached = Math.min(usage.cached, usage.input);
    const dedupKey = `${timestamp ?? ""}|${model}|${usage.input}|${cached}|${usage.output}|${usage.reasoning}|${usage.total}`;
    if (seen.has(dedupKey)) {
      turnTools = [];
      return;
    }
    seen.add(dedupKey);

    const delta: UsageTotals = {
      inputTokens: Math.max(0, usage.input - cached),
      cacheReadTokens: cached,
      cacheCreationTokens: 0,
      outputTokens: usage.output,
      turns: 1,
      longContextInputTokens: usage.input > 272000 ? Math.max(0, usage.input - cached) : 0,
      longContextCacheReadTokens: usage.input > 272000 ? cached : 0,
      longContextOutputTokens: usage.input > 272000 ? usage.output : 0,
    };
    const accs = [(stats.usageByModel[model] ??= emptyUsage())];
    if (timestamp) {
      const day = (stats.dailyUsage[timestamp.slice(0, 10)] ??= {});
      accs.push((day[model] ??= emptyUsage()));
    }
    for (const u of accs) {
      u.inputTokens += delta.inputTokens;
      u.cacheReadTokens += delta.cacheReadTokens;
      u.outputTokens += delta.outputTokens;
      u.turns += 1;
      u.longContextInputTokens = (u.longContextInputTokens ?? 0) + (delta.longContextInputTokens ?? 0);
      u.longContextCacheReadTokens = (u.longContextCacheReadTokens ?? 0) + (delta.longContextCacheReadTokens ?? 0);
      u.longContextOutputTokens = (u.longContextOutputTokens ?? 0) + (delta.longContextOutputTokens ?? 0);
    }
    const turnCost = costUsd(delta, model).total;
    if (turnCost > 0 && turnTools.length > 0) {
      const share = turnCost / turnTools.length;
      for (const name of turnTools) {
        stats.toolCostUsd[name] = (stats.toolCostUsd[name] ?? 0) + share;
      }
    }
    turnTools = [];
  };

  for (const parsed of lines) {
    const { timestamp, type, payload } = parsed;

    if (!stats.cwd) {
      const payloadCwd = typeof payload?.cwd === "string" ? payload.cwd : undefined;
      stats.cwd = payloadCwd ?? parsed.cwd;
    }
    if (timestamp) {
      if (!stats.firstTs) stats.firstTs = timestamp;
      stats.lastTs = timestamp;
    }

    const toolName =
      payload?.type === "function_call" || payload?.type === "custom_tool_call"
        ? nonEmpty(payload.name)
        : payload?.type === "local_shell_call"
          ? "shell"
          : type === "function_call"
            ? nonEmpty(parsed.obj.name)
            : undefined;
    if (toolName) {
      stats.toolCalls[toolName] = (stats.toolCalls[toolName] ?? 0) + 1;
      turnTools.push(toolName);
    }

    if (type === "turn_context") {
      const model = modelFromParts(payload);
      if (model !== undefined) {
        modelState.current = model;
        modelState.currentIsFallback = false;
      }
      continue;
    }

    if (type === "event_msg" && payload?.type === "token_count") {
      const info = asDict(payload.info);
      const ts = typeof parsed.obj.timestamp === "string" ? parsed.obj.timestamp : undefined;
      
      if (replaySecond !== undefined && skipReplay) {
        const matchesReplay = ts && ts.length >= 19 && ts.slice(0, 19) === replaySecond;
        if (matchesReplay) {
          const totals = rawUsage(info?.total_token_usage);
          if (totals) prev = totals;
          continue;
        }
        skipReplay = false;
      }

      if (info) {
        const totals = rawUsage(info.total_token_usage);
        const last = rawUsage(info.last_token_usage);
        if (!last && !totals) continue;

        const usage = last ?? subtractUsage(totals!, prev);
        if (totals) prev = totals;

        if (usage.input === 0 && usage.cached === 0 && usage.output === 0 && usage.reasoning === 0) {
          continue;
        }

        const parsedModel = modelFromParts(payload) ?? modelFromParts(info);
        const model = resolveModel(parsedModel, ts ?? "", modelState);
        accumulate(usage, model, ts);
        continue;
      }
    }

    if (type === "event_msg" || payload?.type === "turn_context") continue;

    const usage = headlessUsage(parsed.obj);
    if (!usage) continue;
    const eventTs = headlessTimestamp(parsed.obj, normalizeTimestamp) ?? (await fileMtime());
    const modelTs = headlessTimestamp(parsed.obj, rawOrNormalizedTimestamp) ?? (await fileMtime());
    const model = resolveModel(headlessModel(parsed.obj), modelTs, modelState);
    accumulate(usage, model, eventTs);
  }
  return stats;
}

export async function loadCodexProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  // Source collection: for each Codex home, sessions/ and
  // archived_sessions/ are separate sources; when both contain the same
  // relative file path, the active sessions/ copy wins. A home with neither
  // directory is scanned as a whole.
  const files: string[] = [];
  for (const root of codexHomes(home)) {
    const sources: string[] = [];
    for (const dir of ["sessions", "archived_sessions"]) {
      const full = join(root, dir);
      const ok = await access(full)
        .then(() => true)
        .catch(() => false);
      if (ok) sources.push(full);
    }
    if (sources.length === 0) sources.push(root);

    const seenRelative = new Set<string>();
    for (const source of sources) {
      const found = await glob(["**/*.jsonl"], { cwd: source, absolute: false })
        .catch(() => [] as string[]);
      found.sort();
      for (const rel of found) {
        const key = rel.replaceAll("\\", "/");
        if (seenRelative.has(key)) continue;
        seenRelative.add(key);
        files.push(join(source, rel));
      }
    }
  }
  if (files.length === 0) return [];

  const sessions: SessionStats[] = [];
  // Shared across files so token_count events replayed into forked sessions
  // are counted once, not once per copy.
  const seen = new Set<string>();
  let parsed = 0;
  for (const f of files) {
    onProgress?.({ parsed, total: files.length, currentProject: "Codex sessions" });
    sessions.push(await parseCodexRollout(f, seen));
    parsed += 1;
    onProgress?.({ parsed, total: files.length, currentProject: "Codex sessions" });
  }
  return groupSessionsByCwd("codex", sessions);
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  name: "OpenAI Codex",
  supported: true,
  async detect(home) {
    for (const root of codexHomes(home)) {
      const ok = await access(join(root, "sessions"))
        .then(() => true)
        .catch(() => false);
      if (ok) return true;
    }
    return false;
  },
  loadProjects: loadCodexProjects,
};
