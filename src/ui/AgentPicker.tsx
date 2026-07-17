import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentData } from "../agents/types.js";
import { usd } from "../format.js";
import { Banner, bannerHeight, type BannerMode } from "./Banner.js";
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

  // Fit the whole picker inside the fixed-height screen: reserve the fixed
  // chrome, give the banner what's left, and shrink it (full -> tiny -> none)
  // before ever clipping the title or the agent list. Even a one-row overflow
  // corrupts Ink's alt-screen redraw (garbled banner, colliding rows).
  // Fixed chrome: Fullscreen padding (2) + App footer hint (1) + "Pick an agent"
  // (1) + list marginTop (1) + border top/bottom (2) + indicator (1) + 1 row of
  // safety headroom so we never render right up to the last line.
  const FIXED_CHROME = 9;
  const LIST_MIN = 3;
  const forcedTiny = cols < 40;
  const bannerBudget = rows - FIXED_CHROME - LIST_MIN;
  const bannerMode: BannerMode =
    !forcedTiny && bannerBudget >= 7 ? "full" : bannerBudget >= 3 ? "tiny" : "none";
  const visibleRows = Math.max(1, rows - FIXED_CHROME - bannerHeight(bannerMode));
  const selectedDisplayIdx = selectable[clamped] ?? 0;
  const offset = windowOffset(selectedDisplayIdx, agents.length, visibleRows);
  const visible = agents.slice(offset, offset + visibleRows);
  const hiddenBelow = agents.length - offset - visible.length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner subtitle="where your agents' tokens and dollars actually go" mode={bannerMode} />
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
