import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import type { AuditReport } from "../types.js";
import { usd, tok } from "../format.js";
import { BarChart } from "./BarChart.js";

const TABS = ["Overview", "Models", "Tools", "Servers"] as const;

function TabBody({ tab, r }: { tab: number; r: AuditReport }) {
  if (tab === 0) {
    const rows = Object.entries(r.costByModel).map(([m, c]) => ({ label: m, value: c.total, display: usd(c.total) }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no usage</Text>;
  }
  if (tab === 1) {
    const rows = Object.entries(r.usageByModel).map(([m, u]) => ({ label: m, value: u.outputTokens, display: `${tok(u.outputTokens)} out` }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no usage</Text>;
  }
  if (tab === 2) {
    const rows = Object.entries(r.toolCalls)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([n, c]) => ({ label: n, value: c, display: String(c) }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no tool calls</Text>;
  }
  if (r.servers.length === 0) return <Text dimColor>no MCP servers configured</Text>;
  return (
    <Box flexDirection="column">
      {r.servers.map((s, i) => (
        <Text key={i}>
          {s.name} · {s.callsObserved} calls ·{" "}
          {s.unused ? <Text color="red">UNUSED</Text> : <Text color="green">used</Text>}
        </Text>
      ))}
    </Box>
  );
}

export function Dashboard({ project, initialTab = 0 }: { project: ProjectAudit; initialTab?: number }) {
  const [tab, setTab] = useState(initialTab);
  useInput((input) => {
    const n = Number.parseInt(input, 10);
    if (n >= 1 && n <= TABS.length) setTab(n - 1);
  });
  const r = project.report;
  return (
    <Box flexDirection="column">
      <Text bold>{project.name}</Text>
      <Text>
        {usd(r.totalCostUsd)} API-equivalent · proj {usd(r.monthlyProjectionUsd)}/mo · {r.sessionCount} sessions · {r.spanDays}d
      </Text>
      <Text dimColor>esc back · q quit · {TABS.map((t, i) => `[${i + 1}]${t}`).join(" ")}</Text>
      <Box marginTop={1}>
        <TabBody tab={tab} r={r} />
      </Box>
    </Box>
  );
}
