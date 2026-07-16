import { costUsd, emptyUsage, resolvePrice } from "./pricing.js";
import type {
  AuditReport,
  CostBreakdown,
  DailyStat,
  McpServer,
  SessionStats,
  SessionSummary,
  UsageTotals,
} from "./types.js";

const DAY_MS = 86_400_000;

export function addUsage(acc: UsageTotals, u: UsageTotals): void {
  acc.inputTokens += u.inputTokens;
  acc.cacheReadTokens += u.cacheReadTokens;
  acc.cacheCreationTokens += u.cacheCreationTokens;
  acc.outputTokens += u.outputTokens;
  acc.turns += u.turns;
}

/** What the cache reads would have cost at full input price, minus the 0.1x they did cost. */
export function cacheSavings(usageByModel: Record<string, UsageTotals>): number {
  let saved = 0;
  for (const [model, u] of Object.entries(usageByModel)) {
    saved += (u.cacheReadTokens / 1e6) * resolvePrice(model).inputPerMTok * 0.9;
  }
  return saved;
}

export function cacheHitRate(usageByModel: Record<string, UsageTotals>): number {
  let read = 0;
  let input = 0;
  for (const u of Object.values(usageByModel)) {
    read += u.cacheReadTokens;
    input += u.inputTokens;
  }
  const denom = read + input;
  return denom > 0 ? read / denom : 0;
}

export function buildDaily(dailyUsage: Record<string, Record<string, UsageTotals>>): DailyStat[] {
  return Object.entries(dailyUsage)
    .map(([date, byModel]) => {
      const stat: DailyStat = {
        date,
        costUsd: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        turns: 0,
      };
      for (const [model, u] of Object.entries(byModel)) {
        stat.costUsd += costUsd(u, model).total;
        stat.inputTokens += u.inputTokens;
        stat.cacheReadTokens += u.cacheReadTokens;
        stat.cacheCreationTokens += u.cacheCreationTokens;
        stat.outputTokens += u.outputTokens;
        stat.turns += u.turns;
      }
      return stat;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function summarizeSession(s: SessionStats): SessionSummary {
  const byCost = Object.entries(s.usageByModel)
    .map(([model, u]) => ({ model, cost: costUsd(u, model).total, turns: u.turns }))
    .sort((a, b) => b.cost - a.cost);
  return {
    file: s.file,
    start: s.firstTs,
    end: s.lastTs,
    costUsd: byCost.reduce((sum, m) => sum + m.cost, 0),
    turns: byCost.reduce((sum, m) => sum + m.turns, 0),
    toolCallCount: Object.values(s.toolCalls).reduce((sum, n) => sum + n, 0),
    models: byCost.map((m) => m.model),
  };
}

export function buildReport(sessions: SessionStats[], servers: McpServer[]): AuditReport {
  const usageByModel: Record<string, UsageTotals> = {};
  const toolCalls: Record<string, number> = {};
  const dailyUsage: Record<string, Record<string, UsageTotals>> = {};
  let earliest = Infinity;
  let latest = -Infinity;

  for (const s of sessions) {
    for (const [model, u] of Object.entries(s.usageByModel)) {
      addUsage((usageByModel[model] ??= emptyUsage()), u);
    }
    for (const [name, n] of Object.entries(s.toolCalls)) {
      toolCalls[name] = (toolCalls[name] ?? 0) + n;
    }
    for (const [date, byModel] of Object.entries(s.dailyUsage ?? {})) {
      const day = (dailyUsage[date] ??= {});
      for (const [model, u] of Object.entries(byModel)) {
        addUsage((day[model] ??= emptyUsage()), u);
      }
    }
    if (s.firstTs) earliest = Math.min(earliest, Date.parse(s.firstTs));
    if (s.lastTs) latest = Math.max(latest, Date.parse(s.lastTs));
  }

  const costByModel: Record<string, CostBreakdown> = {};
  let totalCostUsd = 0;
  let totalTurns = 0;
  for (const [model, u] of Object.entries(usageByModel)) {
    costByModel[model] = costUsd(u, model);
    totalCostUsd += costByModel[model].total;
    totalTurns += u.turns;
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
    daily: buildDaily(dailyUsage),
    sessions: sessions
      .map(summarizeSession)
      .sort((a, b) => b.costUsd - a.costUsd),
    cacheSavingsUsd: cacheSavings(usageByModel),
    cacheHitRate: cacheHitRate(usageByModel),
    totalTurns,
  };
}
