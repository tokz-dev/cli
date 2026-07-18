import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Optional persistent defaults, read from ~/.tokz/config.json at startup.
 * CLI flags always win over config values. Unknown keys are ignored; a missing
 * or malformed file yields empty defaults (never throws).
 */
export interface TokzConfig {
  timezone?: string;
  offline?: boolean;
  costSource?: "auto" | "cc" | "calc" | "both";
  days?: number;
}

const COST_SOURCES = new Set(["auto", "cc", "calc", "both"]);

export function loadConfig(home: string = homedir()): TokzConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(home, ".tokz", "config.json"), "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const cfg: TokzConfig = {};
  if (typeof r.timezone === "string") cfg.timezone = r.timezone;
  if (typeof r.offline === "boolean") cfg.offline = r.offline;
  if (typeof r.costSource === "string" && COST_SOURCES.has(r.costSource))
    cfg.costSource = r.costSource as TokzConfig["costSource"];
  if (typeof r.days === "number" && Number.isFinite(r.days) && r.days > 0) cfg.days = Math.trunc(r.days);
  return cfg;
}
