export interface UsageTotals {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  turns: number;
}

export interface SessionStats {
  file: string;
  /** real project directory, captured from the transcript's cwd field */
  cwd?: string;
  firstTs?: string;
  lastTs?: string;
  usageByModel: Record<string, UsageTotals>;
  toolCalls: Record<string, number>;
  /**
   * Estimated cost per tool: each turn's cost split evenly across the tools
   * that turn invoked. A heuristic — tokens bill per turn, not per tool.
   */
  toolCostUsd: Record<string, number>;
  /** per ISO date (YYYY-MM-DD), per model */
  dailyUsage: Record<string, Record<string, UsageTotals>>;
}

export interface SessionSummary {
  file: string;
  start?: string; // ISO timestamp
  end?: string; // ISO timestamp
  costUsd: number;
  turns: number;
  toolCallCount: number;
  models: string[]; // sorted by cost, highest first
}

export interface DailyStat {
  date: string; // YYYY-MM-DD
  costUsd: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  turns: number;
}

export interface McpServer {
  name: string;
  source: string; // config file it came from
}

export interface ServerAudit extends McpServer {
  callsObserved: number;
  unused: boolean;
  /** estimated cost of turns that called this server's tools */
  estCostUsd: number;
  /** false when the server was seen in transcripts but not in any config we read (e.g. plugin MCP servers) */
  configured: boolean;
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
  spanStart?: string; // ISO date (YYYY-MM-DD) of earliest activity
  spanEnd?: string; // ISO date (YYYY-MM-DD) of latest activity
  usageByModel: Record<string, UsageTotals>;
  costByModel: Record<string, CostBreakdown>;
  totalCostUsd: number;
  monthlyProjectionUsd: number;
  toolCalls: Record<string, number>;
  /** estimated cost per tool (turn cost split across that turn's tool calls) */
  toolCostUsd: Record<string, number>;
  servers: ServerAudit[];
  daily: DailyStat[]; // sorted ascending by date
  sessions: SessionSummary[]; // sorted by cost, highest first
  /** what the cache-read tokens would have cost at full input price, minus what they did cost */
  cacheSavingsUsd: number;
  /** cacheRead / (cacheRead + input): how much of the context arrived from cache */
  cacheHitRate: number;
  totalTurns: number;
}
