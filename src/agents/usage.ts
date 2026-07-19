import { readFile } from "node:fs/promises";
import { emptyUsage } from "../pricing.js";
import type { SessionStats } from "../types.js";

/**
 * Shared plumbing for the smaller agent adapters. Each of them boils down to:
 * read some local files, pull out per-turn usage records, then build a
 * SessionStats. Only the parsing differs, so it lives in each adapter; the
 * accumulation lives here.
 */

export interface UsageRecord {
  model: string;
  ts?: string; // ISO timestamp, if the source records one
  /** Stable per-event id (message/response id) when the source provides one. */
  id?: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Identity for dropping duplicate usage events — the same inference re-read from
 * a resumed/forked session, the same session found under two scanned roots, or
 * an idempotent re-run. Scoped by a stable id (preferred) or the timestamp, plus
 * the model and every token count, so two events collapse only when they are
 * byte-for-byte identical. Distinct usage (any differing token) is always kept,
 * and a record with neither id nor timestamp is never deduped (returns
 * undefined) since it has no reliable identity.
 */
export function recordDedupKey(r: UsageRecord): string | undefined {
  const scope = r.id ?? r.ts;
  if (!scope) return undefined;
  return `${scope}|${r.model}|${r.input}|${r.output}|${r.cacheRead}|${r.cacheWrite}`;
}

export async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Parse a JSONL file into objects, skipping blank and malformed lines. */
export async function readJsonl(file: string): Promise<unknown[]> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

/**
 * Build one SessionStats from a session's usage records (all skipped if empty).
 * Pass a shared `seen` set across every file/session of an agent to drop
 * duplicate events (see recordDedupKey); omit it to count every record.
 */
export function sessionFromRecords(
  file: string,
  cwd: string | undefined,
  records: UsageRecord[],
  seen?: Set<string>,
): SessionStats {
  const stats: SessionStats = { file, cwd, usageByModel: {}, toolCalls: {}, toolCostUsd: {}, dailyUsage: {} };
  for (const r of records) {
    if (r.input + r.output + r.cacheRead + r.cacheWrite === 0) continue;
    if (seen) {
      const key = recordDedupKey(r);
      if (key !== undefined) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
    }
    if (r.ts) {
      if (!stats.firstTs || r.ts < stats.firstTs) stats.firstTs = r.ts;
      if (!stats.lastTs || r.ts > stats.lastTs) stats.lastTs = r.ts;
    }
    const accs = [(stats.usageByModel[r.model] ??= emptyUsage())];
    if (r.ts) {
      const day = (stats.dailyUsage[r.ts.slice(0, 10)] ??= {});
      accs.push((day[r.model] ??= emptyUsage()));
    }
    for (const u of accs) {
      u.inputTokens += r.input;
      u.outputTokens += r.output;
      u.cacheReadTokens += r.cacheRead;
      u.cacheCreationTokens += r.cacheWrite;
      u.turns += 1;
    }
  }
  return stats;
}

/** First finite number among the given object keys (lenient: strings, floats). */
export function pickNum(obj: unknown, keys: string[]): number {
  if (!obj || typeof obj !== "object") return 0;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  return 0;
}

export function str(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Coerce a stored timestamp to an ISO string. Accepts an ISO/date string, or a
 * numeric epoch in seconds or milliseconds (values below ~year 2001 in ms are
 * treated as seconds). Returns undefined when it can't be read.
 */
export function toIso(value: unknown): string | undefined {
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    let ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    if (ms < 1e12) ms *= 1000; // seconds -> milliseconds
    return new Date(ms).toISOString();
  }
  return undefined;
}

/**
 * First nested object (depth-first, self included) that owns at least one of
 * `keys`. Used by adapters whose usage object sits at an uncertain nesting
 * depth, so we locate it by its field names rather than a fixed path.
 */
export function deepFind(node: unknown, keys: string[], depth = 6): Record<string, unknown> | undefined {
  if (!node || typeof node !== "object" || depth < 0) return undefined;
  const rec = node as Record<string, unknown>;
  if (!Array.isArray(node) && keys.some((k) => k in rec)) return rec;
  for (const v of Object.values(rec)) {
    const hit = deepFind(v, keys, depth - 1);
    if (hit) return hit;
  }
  return undefined;
}
