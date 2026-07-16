import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import type { AuditReport } from "../types.js";
import { usd, tok } from "../format.js";
import { BarChart } from "./BarChart.js";

const TABS = ["Overview", "Models", "Tools", "Servers"] as const;

function TabBar({ tab }: { tab: number }) {
  return (
    <Box>
      {TABS.map((t, i) => (
        <Text key={t} color={i === tab ? "black" : "gray"} backgroundColor={i === tab ? "cyan" : undefined} bold={i === tab}>
          {` ${i + 1} ${t} `}
        </Text>
      ))}
    </Box>
  );
}

function TabBody({ tab, r }: { tab: number; r: AuditReport }) {
  if (tab === 0) {
    const rows = Object.entries(r.costByModel)
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([m, c]) => ({ label: m, value: c.total, display: usd(c.total) }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no usage recorded</Text>;
  }
  if (tab === 1) {
    const rows = Object.entries(r.usageByModel)
      .sort(([, a], [, b]) => b.outputTokens - a.outputTokens)
      .map(([m, u]) => ({ label: m, value: u.outputTokens, display: `${tok(u.outputTokens)} out` }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no usage recorded</Text>;
  }
  if (tab === 2) {
    const rows = Object.entries(r.toolCalls)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([n, c]) => ({ label: n, value: c, display: String(c) }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no tool calls</Text>;
  }
  if (r.servers.length === 0) return <Text dimColor>no MCP servers configured</Text>;
  const nameW = Math.max(...r.servers.map((s) => s.name.length));
  return (
    <Box flexDirection="column">
      {r.servers.map((s) => (
        <Text key={s.name}>
          <Text color="cyan">{s.name.padEnd(nameW)}</Text>
          {"  "}
          {String(s.callsObserved).padStart(5)} calls{"  "}
          {s.unused ? <Text color="red">● UNUSED</Text> : <Text color="green">● used</Text>}
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
  const span = r.spanStart && r.spanEnd ? `${r.spanStart} → ${r.spanEnd}` : `${r.spanDays}d`;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          {project.name.replace(/\\/g, "/")}
        </Text>
        <Text>
          <Text bold>{usd(r.totalCostUsd)}</Text>
          <Text dimColor> API-equivalent</Text>
          {"  ·  "}
          <Text bold>{usd(r.monthlyProjectionUsd)}</Text>
          <Text dimColor>/mo projected</Text>
        </Text>
        <Text dimColor>
          {r.sessionCount} sessions · {span}
        </Text>
      </Box>

      <TabBar tab={tab} />

      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} marginTop={0}>
        <TabBody tab={tab} r={r} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>1–4 switch tab · esc back · q quit</Text>
      </Box>
    </Box>
  );
}
