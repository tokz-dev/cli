import type { AuditReport } from "../src/types.js";

export function mkReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    sessionCount: 1,
    spanDays: 1,
    usageByModel: {},
    costByModel: {},
    totalCostUsd: 0,
    monthlyProjectionUsd: 0,
    toolCalls: {},
    servers: [],
    daily: [],
    sessions: [],
    cacheSavingsUsd: 0,
    cacheHitRate: 0,
    totalTurns: 0,
    ...overrides,
  };
}
