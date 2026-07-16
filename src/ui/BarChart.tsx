import { Box, Text } from "ink";
import { bar } from "./bars.js";
import { pct } from "../format.js";

export interface ChartRow {
  label: string;
  value: number;
  display?: string;
  color?: string;
}

export function BarChart({
  rows,
  width = 22,
  showShare = false,
  maxLabel = 34,
}: {
  rows: ChartRow[];
  width?: number;
  showShare?: boolean;
  maxLabel?: number;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  const clip = (s: string) => (s.length > maxLabel ? "…" + s.slice(-(maxLabel - 1)) : s);
  const labelW = Math.min(maxLabel, Math.max(0, ...rows.map((r) => r.label.length)));
  const dispW = Math.max(0, ...rows.map((r) => (r.display ?? String(r.value)).length));
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Text key={r.label}>
          <Text dimColor>{clip(r.label).padEnd(labelW)}</Text>
          {"  "}
          <Text color={r.color ?? "cyan"}>{bar(r.value, max, width).padEnd(width)}</Text>
          {"  "}
          <Text bold>{(r.display ?? String(r.value)).padStart(dispW)}</Text>
          {showShare && total > 0 ? <Text dimColor>{` ${pct(r.value / total).padStart(4)}`}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
