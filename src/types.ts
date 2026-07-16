export interface UsageTotals {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  turns: number;
}

export interface SessionStats {
  file: string;
  firstTs?: string;
  lastTs?: string;
  usageByModel: Record<string, UsageTotals>;
  toolCalls: Record<string, number>;
}

export interface McpServer {
  name: string;
  source: string; // config file it came from
}

export interface ServerAudit extends McpServer {
  callsObserved: number;
  unused: boolean;
}

export interface CostBreakdown {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
}

export interface AuditReport {
  sessionCount: number;
  spanDays: number;
  usageByModel: Record<string, UsageTotals>;
  costByModel: Record<string, CostBreakdown>;
  totalCostUsd: number;
  monthlyProjectionUsd: number;
  toolCalls: Record<string, number>;
  servers: ServerAudit[];
}
