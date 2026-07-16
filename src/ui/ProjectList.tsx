import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ProjectAudit } from "../projects.js";
import { usd } from "../format.js";
import { bar } from "./bars.js";

function shorten(p: string): string {
  return p.length > 44 ? "…" + p.slice(-43) : p;
}

export function ProjectList({ projects, onSelect }: { projects: ProjectAudit[]; onSelect: (index: number) => void }) {
  const total = projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
  const max = Math.max(0, ...projects.map((p) => p.report.totalCostUsd));
  const items = projects.map((p, i) => ({
    key: p.id,
    label: `${shorten(p.name).padEnd(45)} ${usd(p.report.totalCostUsd).padStart(9)}  ${bar(p.report.totalCostUsd, max, 16)}`,
    value: i,
  }));
  return (
    <Box flexDirection="column">
      <Text bold>
        tokz — {projects.length} projects · {usd(total)} API-equivalent
      </Text>
      <Text dimColor>↑↓ move · ⏎ open · q quit</Text>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value as number)} />
    </Box>
  );
}
