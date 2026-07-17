import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ProjectAudit } from "../projects.js";
import type { AuditReport } from "../types.js";
import { usd, compact, pct1 } from "../format.js";
import { Banner } from "./Banner.js";
import { Sparkline } from "./Sparkline.js";
import { StatCards } from "./StatCards.js";
import { theme } from "./theme.js";

export type MenuAction = "list" | "aggregate" | "quit";

function Indicator({ isSelected }: { isSelected?: boolean }) {
  return <Text color={theme.accent}>{isSelected ? "▸ " : "  "}</Text>;
}

function Button({ isSelected, label }: { isSelected?: boolean; label: string }) {
  return (
    <Text color={isSelected ? "black" : theme.accent} backgroundColor={isSelected ? theme.accent : undefined} bold>
      {`  ${label}  `}
    </Text>
  );
}

export function Menu({
  projects,
  totals,
  agentName,
  onSelect,
}: {
  projects: ProjectAudit[];
  totals: AuditReport;
  agentName?: string;
  onSelect: (action: MenuAction) => void;
}) {
  const range =
    totals.spanStart && totals.spanEnd ? `${totals.spanStart} → ${totals.spanEnd}` : "no dated activity";
  const last30 = totals.daily.slice(-30).map((d) => d.costUsd);
  const unused = totals.servers.filter((s) => s.unused).length;

  const items = [
    { key: "list", label: "Browse projects", value: "list" as const },
    { key: "aggregate", label: "All projects (aggregate)", value: "aggregate" as const },
    { key: "quit", label: "Quit", value: "quit" as const },
  ];

  return (
    <Box flexDirection="column">
      <Banner
        subtitle={`${agentName ? `${agentName} · ` : ""}where your agent's tokens and dollars go`}
      />

      <Box marginBottom={1}>
        <StatCards
          stats={[
            { label: "Total cost", value: usd(totals.totalCostUsd), color: theme.accent },
            { label: "Projected", value: usd(totals.monthlyProjectionUsd), hint: "/mo" },
            { label: "Projects", value: String(projects.length) },
            { label: "Sessions", value: String(totals.sessionCount) },
            { label: "Turns", value: compact(totals.totalTurns) },
            {
              label: "Cache hit",
              value: pct1(totals.cacheHitRate),
              color: totals.cacheHitRate > 0.8 ? theme.good : theme.warn,
            },
          ]}
        />
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Sparkline values={last30.length > 0 ? last30 : [0]} />
          <Text dimColor>  activity (last {Math.max(1, last30.length)} active days)</Text>
        </Text>
        <Text dimColor>{range}</Text>
        {unused > 0 ? (
          <Text color={theme.bad}>⚠ {unused} configured MCP server{unused > 1 ? "s" : ""} never called</Text>
        ) : null}
      </Box>

      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} indicatorComponent={Indicator} itemComponent={Button} />
    </Box>
  );
}
