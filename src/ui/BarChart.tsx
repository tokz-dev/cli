import { Box, Text } from "ink";
import { bar } from "./bars.js";

export interface ChartRow {
  label: string;
  value: number;
  display?: string;
  color?: string;
}

export function BarChart({ rows, width = 24 }: { rows: ChartRow[]; width?: number }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const labelW = Math.max(0, ...rows.map((r) => r.label.length));
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => (
        <Text key={i}>
          {r.label.padEnd(labelW)} <Text color={r.color ?? "cyan"}>{bar(r.value, max, width)}</Text>{" "}
          {r.display ?? String(r.value)}
        </Text>
      ))}
    </Box>
  );
}
