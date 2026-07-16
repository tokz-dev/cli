import Table from "cli-table3";
import pc from "picocolors";
import type { AuditReport } from "./types.js";

const usd = (n: number) => `$${n.toFixed(2)}`;
const tok = (n: number) => n.toLocaleString("en-US");

export function renderReport(report: AuditReport): string {
  const parts: string[] = [];

  parts.push(
    pc.bold(
      `tokz audit — ${report.sessionCount} sessions over ${report.spanDays} days: ` +
        `${usd(report.totalCostUsd)} API-equivalent cost, projected ${usd(report.monthlyProjectionUsd)}/month`,
    ),
  );
  parts.push(
    pc.dim(
      "Cost = what these tokens would bill at Anthropic API pay-as-you-go rates. " +
        "On a Pro/Max subscription you pay a flat fee, not this — treat it as value received, not a bill.",
    ),
  );

  const costTable = new Table({ head: ["Model", "Input", "Cache read", "Cache write", "Output", "Cost"] });
  for (const [model, u] of Object.entries(report.usageByModel)) {
    const c = report.costByModel[model];
    costTable.push([model, tok(u.inputTokens), tok(u.cacheReadTokens), tok(u.cacheCreationTokens), tok(u.outputTokens), usd(c.total)]);
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
    parts.push(serverTable.toString());
  }

  const topTools = Object.entries(report.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  if (topTools.length > 0) {
    const toolTable = new Table({ head: ["Tool", "Calls"] });
    for (const [name, n] of topTools) toolTable.push([name, String(n)]);
    parts.push(toolTable.toString());
  }

  return parts.join("\n\n");
}
