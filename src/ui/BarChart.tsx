import { Box, Text } from "ink";
import { bar } from "./bars.js";

export interface ChartRow {
  label: string;
  value: number;
  display?: string;
  color?: string;
}

export function BarChart({ rows, width = 22 }: { rows: ChartRow[]; width?: number }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const labelW = Math.max(0, ...rows.map((r) => r.label.length));
  const dispW = Math.max(0, ...rows.map((r) => (r.display ?? String(r.value)).length));
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Text key={r.label}>
          <Text dimColor>{r.label.padEnd(labelW)}</Text>
          {"  "}
          <Text color={r.color ?? "cyan"}>{bar(r.value, max, width).padEnd(width)}</Text>
          {"  "}
          <Text bold>{(r.display ?? String(r.value)).padStart(dispW)}</Text>
        </Text>
      ))}
    </Box>
  );
}
