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
  acc.cacheCreation1hTokens = (acc.cacheCreation1hTokens ?? 0) + (u.cacheCreation1hTokens ?? 0);
  acc.outputTokens += u.outputTokens;
  acc.turns += u.turns;
  acc.longContextInputTokens = (acc.longContextInputTokens ?? 0) + (u.longContextInputTokens ?? 0);
  acc.longContextCacheReadTokens = (acc.longContextCacheReadTokens ?? 0) + (u.longContextCacheReadTokens ?? 0);
  acc.longContextOutputTokens = (acc.longContextOutputTokens ?? 0) + (u.longContextOutputTokens ?? 0);
}

/** What the cache reads would have cost at full input price, minus what they did cost. */
export function cacheSavings(usageByModel: Record<string, UsageTotals>): number {
  let saved = 0;
  for (const [model, u] of Object.entries(usageByModel)) {
    const p = resolvePrice(model);
    saved += (u.cacheReadTokens / 1e6) * p.inputPerMTok * (1 - (p.cacheReadMult ?? 0.1));
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

/**
 * Restrict a session to activity between two inclusive ISO dates. Usage is
 * rebuilt from the per-day breakdown; tool calls are kept whole for any
 * session that overlaps the range (they aren't dated per day). Returns null
 * when the session has no activity in the range.
 */
export function clampSession(s: SessionStats, from: string, to: string): SessionStats | null {
  const days = Object.entries(s.dailyUsage ?? {}).filter(([d]) => d >= from && d <= to);
  if (days.length === 0) return null;
  const usageByModel: Record<string, UsageTotals> = {};
  for (const [, byModel] of days) {
    for (const [model, u] of Object.entries(byModel)) {
      addUsage((usageByModel[model] ??= emptyUsage()), u);
    }
  }
  // Clamp the session's timestamps to the range so spans and durations
  // reflect only the window being viewed (ISO strings compare lexically).
  const lo = `${from}T00:00:00Z`;
  const hi = `${to}T23:59:59.999Z`;
  const firstTs = s.firstTs && s.firstTs > lo ? s.firstTs : lo;
  const lastTs = s.lastTs && s.lastTs < hi ? s.lastTs : hi;
  return { ...s, firstTs, lastTs, usageByModel, dailyUsage: Object.fromEntries(days) };
}

export function buildReport(
  sessions: SessionStats[],
  servers: McpServer[],
  range?: { from: string; to: string },
): AuditReport {
  if (range) {
    sessions = sessions
      .map((s) => clampSession(s, range.from, range.to))
      .filter((s): s is SessionStats => s !== null);
  }
  const usageByModel: Record<string, UsageTotals> = {};
  const toolCalls: Record<string, number> = {};
  const toolCostUsd: Record<string, number> = {};
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
    for (const [name, c] of Object.entries(s.toolCostUsd ?? {})) {
      toolCostUsd[name] = (toolCostUsd[name] ?? 0) + c;
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

  const mcpSum = (record: Record<string, number>, server: string) =>
    Object.entries(record)
      .filter(([name]) => name.startsWith(`mcp__${server}__`))
      .reduce((sum, [, n]) => sum + n, 0);

  const serverAudits = servers.map((srv) => {
    const callsObserved = mcpSum(toolCalls, srv.name);
    return {
      ...srv,
      callsObserved,
      unused: callsObserved === 0,
      estCostUsd: mcpSum(toolCostUsd, srv.name),
      configured: true,
    };
  });

  // Servers seen in transcripts but absent from every config we read — plugin
  // MCP servers and servers configured elsewhere. Surface them too.
  const configured = new Set(servers.map((s) => s.name));
  const observed = new Set(
    Object.keys(toolCalls)
      .map((name) => /^mcp__(.+)__[^_]/.exec(name)?.[1])
      .filter((s): s is string => !!s),
  );
  for (const name of [...observed].sort()) {
    if ([...configured].some((c) => name === c || name.startsWith(`${c}__`))) continue;
    serverAudits.push({
      name,
      source: "observed in transcripts (plugin or external config)",
      callsObserved: mcpSum(toolCalls, name),
      unused: false,
      estCostUsd: mcpSum(toolCostUsd, name),
      configured: false,
    });
  }

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
    toolCostUsd,
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
