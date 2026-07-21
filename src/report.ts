import Table from "cli-table3";
import pc from "picocolors";
import type { Grouping } from "./dates.js";
import { usd, tok, pct1 } from "./format.js";
import type { AuditReport, DailyStat } from "./types.js";

const sumBy = <T,>(rows: T[], pick: (row: T) => number): number =>
  rows.reduce((total, row) => total + pick(row), 0);

const ACTIVITY_HEAD: Record<Grouping, string> = { day: "Day", week: "Week of", month: "Month" };

export interface ActivityFlags {
  daily?: boolean;
  weekly?: boolean;
  monthly?: boolean;
  /** comma-separated units, or "none" to drop the activity table entirely */
  breakdown?: string;
}

/**
 * Which activity tables an audit should append. A day breakdown is the default;
 * asking for any unit explicitly replaces it, and "--breakdown none" drops it.
 * Result is always ordered coarse-to-fine, whatever order the flags came in.
 */
export function activityUnits(flags: ActivityFlags): Grouping[] {
  const units = new Set<Grouping>();
  let none = false;
  if (flags.daily) units.add("day");
  if (flags.weekly) units.add("week");
  if (flags.monthly) units.add("month");
  for (const raw of flags.breakdown?.split(",") ?? []) {
    // Accept "daily"/"days"/"day" alike.
    const unit = raw.trim().toLowerCase().replace(/(ly|s)$/, "");
    if (unit === "day" || unit === "dai") units.add("day");
    else if (unit === "week") units.add("week");
    else if (unit === "month") units.add("month");
    else if (unit === "none" || unit === "no") none = true;
  }
  if (none) return [];
  if (units.size === 0) units.add("day");
  return (["month", "week", "day"] as const).filter((u) => units.has(u));
}

/** Activity table for daily stats already rolled up by day, week, or month. */
export function renderActivity(rows: DailyStat[], unit: Grouping): string {
  const head = ACTIVITY_HEAD[unit];
  const table = new Table({ head: [head, "Cost", "Input", "Cache read", "Cache write", "Output", "Turns"] });
  for (const d of rows) {
    table.push([d.date, usd(d.costUsd), tok(d.inputTokens), tok(d.cacheReadTokens), tok(d.cacheCreationTokens), tok(d.outputTokens), String(d.turns)]);
  }
  if (rows.length > 1) {
    table.push([
      pc.bold("TOTAL"),
      pc.bold(usd(sumBy(rows, (d) => d.costUsd))),
      pc.bold(tok(sumBy(rows, (d) => d.inputTokens))),
      pc.bold(tok(sumBy(rows, (d) => d.cacheReadTokens))),
      pc.bold(tok(sumBy(rows, (d) => d.cacheCreationTokens))),
      pc.bold(tok(sumBy(rows, (d) => d.outputTokens))),
      pc.bold(String(sumBy(rows, (d) => d.turns))),
    ]);
  }
  return `${pc.bold(`Activity by ${unit}`)}\n${table.toString()}`;
}

export function renderReport(report: AuditReport): string {
  const parts: string[] = [];

  const span =
    report.spanStart && report.spanEnd
      ? `${report.spanStart} → ${report.spanEnd}`
      : `${report.spanDays} days`;
  parts.push(
    pc.bold(
      `tokz audit — ${report.sessionCount} sessions, ${span}: ` +
        `${usd(report.totalCostUsd)} API-equivalent cost, projected ${usd(report.monthlyProjectionUsd)}/month`,
    ),
  );
  parts.push(
    pc.dim(
      "Cost = what these tokens would bill at Anthropic API pay-as-you-go rates. " +
        "On a Pro/Max subscription you pay a flat fee, not this — treat it as value received, not a bill.",
    ),
  );
  parts.push(
    `Cache hit rate ${pct1(report.cacheHitRate)} — prompt caching saved ${usd(report.cacheSavingsUsd)} vs uncached input pricing.`,
  );

  const costTable = new Table({ head: ["Model", "Input", "Cache read", "Cache write", "Output", "Cost"] });
  const models = Object.entries(report.usageByModel);
  for (const [model, u] of models) {
    const c = report.costByModel[model];
    costTable.push([model, tok(u.inputTokens), tok(u.cacheReadTokens), tok(u.cacheCreationTokens), tok(u.outputTokens), usd(c.total)]);
  }
  if (models.length > 1) {
    costTable.push([
      pc.bold("TOTAL"),
      pc.bold(tok(sumBy(models, ([, u]) => u.inputTokens))),
      pc.bold(tok(sumBy(models, ([, u]) => u.cacheReadTokens))),
      pc.bold(tok(sumBy(models, ([, u]) => u.cacheCreationTokens))),
      pc.bold(tok(sumBy(models, ([, u]) => u.outputTokens))),
      pc.bold(usd(report.totalCostUsd)),
    ]);
  }
  parts.push(costTable.toString());

  if (report.servers.length > 0) {
    const serverTable = new Table({ head: ["MCP server", "Calls observed", "Status", "Configured in"] });
    for (const s of report.servers) {
      serverTable.push([
        s.name,
        String(s.callsObserved),
        s.unused ? pc.red("UNUSED — schema loaded every turn for nothing") : pc.green("used"),
        s.source,
      ]);
    }
    if (report.servers.length > 1) {
      const unused = report.servers.filter((s) => s.unused).length;
      serverTable.push([
        pc.bold("TOTAL"),
        pc.bold(String(sumBy(report.servers, (s) => s.callsObserved))),
        pc.bold(`${report.servers.length} servers, ${unused} unused`),
        "",
      ]);
    }
    parts.push(serverTable.toString());
  }

  const allTools = Object.entries(report.toolCalls).sort(([, a], [, b]) => b - a);
  const topTools = allTools.slice(0, 10);
  if (topTools.length > 0) {
    const toolTable = new Table({ head: ["Tool", "Calls"] });
    for (const [name, n] of topTools) toolTable.push([name, String(n)]);
    if (allTools.length > 1) {
      // Totals cover every tool, not just the ten shown.
      const label = allTools.length > topTools.length ? `TOTAL (${allTools.length} tools)` : "TOTAL";
      toolTable.push([pc.bold(label), pc.bold(String(sumBy(allTools, ([, n]) => n)))]);
    }
    parts.push(toolTable.toString());
  }

  return parts.join("\n\n");
}
