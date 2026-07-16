import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import type { AuditReport } from "../types.js";
import { usd, compact, pct, pct1, shortModel, duration, relativeDate } from "../format.js";
import { BarChart } from "./BarChart.js";
import { Sparkline } from "./Sparkline.js";
import { StatCards } from "./StatCards.js";
import { theme, modelColor } from "./theme.js";
import { useTerminalSize } from "./useTerminalSize.js";

const TABS = ["Overview", "Models", "Tools", "Servers", "Sessions", "Activity"] as const;

function TabBar({ tab, narrow }: { tab: number; narrow: boolean }) {
  return (
    <Box marginBottom={1}>
      {TABS.map((t, i) => (
        <Text
          key={t}
          color={i === tab ? "black" : "gray"}
          backgroundColor={i === tab ? theme.accent : undefined}
          bold={i === tab}
        >
          {narrow ? ` ${i + 1}${i === tab ? ` ${t}` : ""} ` : ` ${i + 1} ${t} `}
        </Text>
      ))}
    </Box>
  );
}

/** Last `n` calendar days of activity, zero-filled so quiet days show as gaps. */
function lastDays(r: AuditReport, n: number): { date: string; costUsd: number; turns: number }[] {
  const byDate = new Map(r.daily.map((d) => [d.date, d]));
  const out: { date: string; costUsd: number; turns: number }[] = [];
  const today = r.spanEnd ? Date.parse(r.spanEnd) : Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date(today - i * 86_400_000).toISOString().slice(0, 10);
    const d = byDate.get(date);
    out.push({ date, costUsd: d?.costUsd ?? 0, turns: d?.turns ?? 0 });
  }
  return out;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold dimColor>
        {title.toUpperCase()}
      </Text>
      {children}
    </Box>
  );
}

function Overview({ r, chartW }: { r: AuditReport; chartW: number }) {
  const days = lastDays(r, 30);
  const peak = days.reduce((a, b) => (b.costUsd > a.costUsd ? b : a), days[0]);
  const models = Object.entries(r.costByModel)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 4)
    .map(([m, c]) => ({ label: shortModel(m), value: c.total, display: usd(c.total), color: modelColor(m) }));
  const tools = Object.entries(r.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([n, c]) => ({ label: n, value: c, display: compact(c), color: n.startsWith("mcp__") ? theme.mcp : theme.accent }));
  const unused = r.servers.filter((s) => s.unused).length;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <StatCards
          stats={[
            { label: "Total cost", value: usd(r.totalCostUsd), color: theme.accent },
            { label: "Projected", value: usd(r.monthlyProjectionUsd), hint: "/mo" },
            { label: "Sessions", value: String(r.sessionCount) },
            { label: "Turns", value: compact(r.totalTurns) },
            { label: "Cache hit", value: pct1(r.cacheHitRate), color: r.cacheHitRate > 0.8 ? theme.good : theme.warn },
            { label: "Cache saved", value: usd(r.cacheSavingsUsd), color: theme.good },
          ]}
        />
      </Box>

      <Section title="last 30 days">
        <Box>
          <Sparkline values={days.map((d) => d.costUsd)} />
          {peak && peak.costUsd > 0 ? (
            <Text dimColor>
              {"  peak "}
              {usd(peak.costUsd)} on {peak.date}
            </Text>
          ) : null}
        </Box>
      </Section>

      {models.length > 0 ? (
        <Section title="cost by model">
          <BarChart rows={models} width={chartW} showShare />
        </Section>
      ) : null}

      {tools.length > 0 ? (
        <Section title="top tools">
          <BarChart rows={tools} width={chartW} />
        </Section>
      ) : null}

      {unused > 0 ? (
        <Text color={theme.bad}>
          ⚠ {unused} MCP server{unused > 1 ? "s" : ""} configured but never called — see tab 4
        </Text>
      ) : null}
    </Box>
  );
}

function Models({ r, cols }: { r: AuditReport; cols: number }) {
  const entries = Object.entries(r.usageByModel).sort(
    ([a], [b]) => r.costByModel[b].total - r.costByModel[a].total,
  );
  if (entries.length === 0) return <Text dimColor>no usage recorded</Text>;
  const nameW = Math.max(...entries.map(([m]) => shortModel(m).length), 5);
  const col = (s: string) => s.padStart(10);
  // Narrow terminals: keep the columns that matter most.
  const full = cols >= nameW + 2 + 10 * 6 + 7;
  const mid = cols >= nameW + 2 + 10 * 3 + 7;
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {"MODEL".padEnd(nameW + 2)}
        {full ? col("INPUT") + col("CACHE RD") + col("CACHE WR") : ""}
        {mid ? col("OUTPUT") + col("TURNS") : ""}
        {col("COST")}
        {"  SHARE"}
      </Text>
      {entries.map(([m, u]) => {
        const c = r.costByModel[m];
        const share = r.totalCostUsd > 0 ? c.total / r.totalCostUsd : 0;
        return (
          <Text key={m}>
            <Text color={modelColor(m)} bold>
              {shortModel(m).padEnd(nameW + 2)}
            </Text>
            {full ? col(compact(u.inputTokens)) + col(compact(u.cacheReadTokens)) + col(compact(u.cacheCreationTokens)) : ""}
            {mid ? col(compact(u.outputTokens)) + col(compact(u.turns)) : ""}
            <Text bold>{col(usd(c.total))}</Text>
            <Text dimColor>{`  ${pct(share).padStart(4)}`}</Text>
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>
          cost split — in {usd(entries.reduce((s, [m]) => s + r.costByModel[m].input, 0))} · cache rd{" "}
          {usd(entries.reduce((s, [m]) => s + r.costByModel[m].cacheRead, 0))} · cache wr{" "}
          {usd(entries.reduce((s, [m]) => s + r.costByModel[m].cacheWrite, 0))} · out{" "}
          {usd(entries.reduce((s, [m]) => s + r.costByModel[m].output, 0))}
        </Text>
      </Box>
    </Box>
  );
}

function Tools({ r, chartW, cols }: { r: AuditReport; chartW: number; cols: number }) {
  const rows = Object.entries(r.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([n, c]) => ({
      label: n,
      value: c,
      display: compact(c),
      color: n.startsWith("mcp__") ? theme.mcp : theme.accent,
    }));
  if (rows.length === 0) return <Text dimColor>no tool calls</Text>;
  const maxLabel = Math.max(12, Math.min(40, cols - chartW - 16));
  const totalCalls = Object.values(r.toolCalls).reduce((s, n) => s + n, 0);
  const mcpCalls = Object.entries(r.toolCalls)
    .filter(([n]) => n.startsWith("mcp__"))
    .reduce((s, [, n]) => s + n, 0);
  return (
    <Box flexDirection="column">
      <BarChart rows={rows} width={chartW} showShare maxLabel={maxLabel} />
      <Box marginTop={1}>
        <Text dimColor>
          {compact(totalCalls)} calls across {Object.keys(r.toolCalls).length} tools ·{" "}
          <Text color={theme.mcp}>magenta = MCP</Text> ({pct(totalCalls > 0 ? mcpCalls / totalCalls : 0)} of calls)
        </Text>
      </Box>
    </Box>
  );
}

function Servers({ r }: { r: AuditReport }) {
  if (r.servers.length === 0)
    return <Text dimColor>no MCP servers configured for this project</Text>;
  const nameW = Math.max(...r.servers.map((s) => s.name.length));
  const sorted = [...r.servers].sort((a, b) => b.callsObserved - a.callsObserved);
  return (
    <Box flexDirection="column">
      {sorted.map((s) => (
        <Text key={s.name}>
          <Text color={theme.accent}>{s.name.padEnd(nameW)}</Text>
          {"  "}
          {compact(s.callsObserved).padStart(6)} calls{"  "}
          {s.unused ? <Text color={theme.bad}>● UNUSED</Text> : <Text color={theme.good}>● used  </Text>}
          {"  "}
          <Text dimColor>{s.source.replace(/\\/g, "/")}</Text>
        </Text>
      ))}
      {sorted.some((s) => s.unused) ? (
        <Box marginTop={1}>
          <Text dimColor>
            Unused servers still load their tool schemas into every request — dead weight in the
            context window. Consider removing them.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Sessions({ r, cols }: { r: AuditReport; cols: number }) {
  const rows = r.sessions.slice(0, 12);
  if (rows.length === 0) return <Text dimColor>no sessions</Text>;
  const wide = cols >= 60;
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {"WHEN".padEnd(12)}
        {"LENGTH".padEnd(9)}
        {wide ? "TURNS".padStart(6) + "TOOLS".padStart(7) : ""}
        {"COST".padStart(9)}
        {"  MODEL"}
      </Text>
      {rows.map((s) => (
        <Text key={s.file}>
          {relativeDate(s.start).padEnd(12)}
          {duration(s.start, s.end).padEnd(9)}
          {wide ? compact(s.turns).padStart(6) + compact(s.toolCallCount).padStart(7) : ""}
          <Text bold>{usd(s.costUsd).padStart(9)}</Text>
          <Text color={s.models[0] ? modelColor(s.models[0]) : undefined}>
            {"  " + (s.models[0] ? shortModel(s.models[0]) : "—")}
          </Text>
        </Text>
      ))}
      {r.sessions.length > rows.length ? (
        <Text dimColor>… {r.sessions.length - rows.length} more (sorted by cost)</Text>
      ) : null}
    </Box>
  );
}

function Activity({ r, chartW, cols }: { r: AuditReport; chartW: number; cols: number }) {
  const days = lastDays(r, 21).filter((d, i, all) => d.costUsd > 0 || i >= all.length - 14);
  const wide = cols >= 66;
  const rows = days.slice(-16).map((d) => ({
    label: `${d.date} ${relativeDate(d.date) === "today" ? "◂" : " "}`,
    value: d.costUsd,
    display:
      d.costUsd > 0 ? (wide ? `${usd(d.costUsd)} · ${compact(d.turns)} turns` : usd(d.costUsd)) : "—",
  }));
  if (r.daily.length === 0) return <Text dimColor>no dated activity</Text>;
  const avg = r.totalCostUsd / Math.max(1, r.daily.length);
  return (
    <Box flexDirection="column">
      <BarChart rows={rows} width={chartW} />
      <Box marginTop={1}>
        <Text dimColor>
          {r.daily.length} active days · avg {usd(avg)}/active day · projected{" "}
          {usd(r.monthlyProjectionUsd)}/mo
        </Text>
      </Box>
    </Box>
  );
}

export function Dashboard({
  project,
  initialTab = 0,
  timeframe,
}: {
  project: ProjectAudit;
  initialTab?: number;
  timeframe?: string;
}) {
  const [tab, setTab] = useState(initialTab);
  const { cols } = useTerminalSize();
  useInput((input, key) => {
    const n = Number.parseInt(input, 10);
    if (n >= 1 && n <= TABS.length) setTab(n - 1);
    if (key.rightArrow) setTab((t) => (t + 1) % TABS.length);
    if (key.leftArrow) setTab((t) => (t + TABS.length - 1) % TABS.length);
  });
  const r = project.report;
  const span = r.spanStart && r.spanEnd ? `${r.spanStart} → ${r.spanEnd}` : `${r.spanDays}d`;
  const fullPath = project.name.replace(/\\/g, "/");
  const chartW = Math.max(10, Math.min(26, cols - 54));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text bold color={theme.accent}>
            {project.label}
          </Text>
          {project.label !== fullPath && cols >= project.label.length + fullPath.length + 6 ? (
            <Text dimColor>  {fullPath}</Text>
          ) : null}
        </Text>
        <Text dimColor>
          {timeframe && timeframe !== "All time" ? (
            <Text color="yellow">{timeframe} · </Text>
          ) : null}
          {r.sessionCount} sessions · {span}
          {cols >= 70 ? " · API-equivalent cost, computed offline" : ""}
        </Text>
      </Box>

      <TabBar tab={tab} narrow={cols < 72} />

      <Box flexDirection="column">
        {tab === 0 ? <Overview r={r} chartW={chartW} /> : null}
        {tab === 1 ? <Models r={r} cols={cols} /> : null}
        {tab === 2 ? <Tools r={r} chartW={chartW} cols={cols} /> : null}
        {tab === 3 ? <Servers r={r} /> : null}
        {tab === 4 ? <Sessions r={r} cols={cols} /> : null}
        {tab === 5 ? <Activity r={r} chartW={chartW} cols={cols} /> : null}
      </Box>
    </Box>
  );
}
