import { costUsd, emptyUsage } from "./pricing.js";
import type { AuditReport, CostBreakdown, McpServer, SessionStats, UsageTotals } from "./types.js";

const DAY_MS = 86_400_000;

export function buildReport(sessions: SessionStats[], servers: McpServer[]): AuditReport {
  const usageByModel: Record<string, UsageTotals> = {};
  const toolCalls: Record<string, number> = {};
  let earliest = Infinity;
  let latest = -Infinity;

  for (const s of sessions) {
    for (const [model, u] of Object.entries(s.usageByModel)) {
      const acc = (usageByModel[model] ??= emptyUsage());
      acc.inputTokens += u.inputTokens;
      acc.cacheReadTokens += u.cacheReadTokens;
      acc.cacheCreationTokens += u.cacheCreationTokens;
      acc.outputTokens += u.outputTokens;
      acc.turns += u.turns;
    }
    for (const [name, n] of Object.entries(s.toolCalls)) {
      toolCalls[name] = (toolCalls[name] ?? 0) + n;
    }
    if (s.firstTs) earliest = Math.min(earliest, Date.parse(s.firstTs));
    if (s.lastTs) latest = Math.max(latest, Date.parse(s.lastTs));
  }

  const costByModel: Record<string, CostBreakdown> = {};
  let totalCostUsd = 0;
  for (const [model, u] of Object.entries(usageByModel)) {
    costByModel[model] = costUsd(u, model);
    totalCostUsd += costByModel[model].total;
  }

  const spanDays =
    Number.isFinite(earliest) && Number.isFinite(latest)
      ? Math.max(1, Math.round((latest - earliest) / DAY_MS))
      : 1;

  const mcpCalls = (server: string) =>
    Object.entries(toolCalls)
      .filter(([name]) => name.startsWith(`mcp__${server}__`))
      .reduce((sum, [, n]) => sum + n, 0);

  const serverAudits = servers.map((srv) => {
    const callsObserved = mcpCalls(srv.name);
    return { ...srv, callsObserved, unused: callsObserved === 0 };
  });

  const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  return {
    sessionCount: sessions.length,
    spanDays,
    spanStart: Number.isFinite(earliest) ? isoDate(earliest) : undefined,
    spanEnd: Number.isFinite(latest) ? isoDate(latest) : undefined,
    usageByModel,
    costByModel,
    totalCostUsd,
    monthlyProjectionUsd: (totalCostUsd / spanDays) * 30,
    toolCalls,
    servers: serverAudits,
  };
}
