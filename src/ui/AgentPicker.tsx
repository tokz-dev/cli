import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentData } from "../agents/types.js";
import { usd } from "../format.js";
import { Banner } from "./Banner.js";
import { theme } from "./theme.js";
import { useTerminalSize } from "./useTerminalSize.js";
import { windowOffset } from "./viewport.js";

function status(a: AgentData): { text: string; color?: string; dim?: boolean } {
  if (a.projects.length > 0) {
    const cost = a.projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
    const sessions = a.projects.reduce((s, p) => s + p.report.sessionCount, 0);
    const est = a.adapter.estimated ? `~` : "";
    const tail = a.adapter.estimated ? " · estimated" : "";
    return { text: `${a.projects.length} projects · ${sessions} sessions · ${est}${usd(cost)}${tail}` };
  }
  if (a.detected && !a.adapter.supported)
    return {
      text: `detected · ${a.adapter.unsupportedReason ?? "parsing not supported yet"}`,
      color: theme.warn,
    };
  if (a.detected) return { text: "detected · no usage data", dim: true };
  return { text: "not detected", dim: true };
}

export function AgentPicker({
  agents,
  onSelect,
}: {
  agents: AgentData[];
  onSelect: (index: number) => void;
}) {
  const selectable = agents
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.projects.length > 0)
    .map(({ i }) => i);
  const [cursor, setCursor] = useState(0);
  const clamped = Math.min(cursor, Math.max(0, selectable.length - 1));
  const { cols, rows } = useTerminalSize();

  useInput((_input, key) => {
    if (key.upArrow) setCursor(() => Math.max(0, clamped - 1));
    if (key.downArrow) setCursor(() => Math.min(selectable.length - 1, clamped + 1));
    if (key.return && selectable[clamped] !== undefined) onSelect(selectable[clamped]);
  });

  const nameW = Math.max(...agents.map((a) => a.adapter.name.length)) + 2;

  // Window over the full displayed list, keeping the selected (selectable) row
  // visible without overflowing the fixed-height screen (which would clip the
  // banner/top row). Budget must match the Banner's own tiny/full height rule.
  const tinyBanner = cols < 40 || rows < 18;
  const bannerRows = tinyBanner ? 3 : 7; // art/wordmark + subtitle + marginBottom
  // Fullscreen padding (2) + banner + "Pick an agent" (1) + marginTop (1) +
  // border top/bottom (2) + the more/less indicator (1).
  const chromeRows = 2 + bannerRows + 1 + 1 + 2 + 1;
  const visibleRows = Math.max(3, rows - chromeRows);
  const selectedDisplayIdx = selectable[clamped] ?? 0;
  const offset = windowOffset(selectedDisplayIdx, agents.length, visibleRows);
  const visible = agents.slice(offset, offset + visibleRows);
  const hiddenBelow = agents.length - offset - visible.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner subtitle="where your agents' tokens and dollars go · 100% offline" />
      <Text bold color={theme.accent}>
        Pick an agent
      </Text>
      <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
        {visible.map((a, vi) => {
          const i = offset + vi;
          const st = status(a);
          const selected = selectable[clamped] === i;
          const selectableRow = a.projects.length > 0;
          return (
            <Text key={a.adapter.id} bold={selected}>
              <Text color={selected ? theme.accent : undefined}>{selected ? "▸ " : "  "}</Text>
              <Text color={selected ? theme.accent : undefined} dimColor={!selectableRow}>
                {a.adapter.name.padEnd(nameW)}
              </Text>
              <Text color={st.color} dimColor={st.dim}>
                {st.text}
              </Text>
            </Text>
          );
        })}
        {agents.length > visibleRows ? (
          <Text dimColor>
            {offset > 0 ? `↑ ${offset} above` : ""}
            {offset > 0 && hiddenBelow > 0 ? " · " : ""}
            {hiddenBelow > 0 ? `↓ ${hiddenBelow} below` : ""}
          </Text>
        ) : null}
        {selectable.length === 0 ? (
          <Text dimColor>no agent usage data found on this machine</Text>
        ) : null}
      </Box>
    </Box>
  );
}
