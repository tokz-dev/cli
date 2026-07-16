import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ProjectAudit } from "../projects.js";
import { usd } from "../format.js";
import { Banner } from "./Banner.js";

export type MenuAction = "list" | "aggregate" | "quit";

function Indicator({ isSelected }: { isSelected?: boolean }) {
  return <Text color="cyan">{isSelected ? "▸ " : "  "}</Text>;
}

function Button({ isSelected, label }: { isSelected?: boolean; label: string }) {
  return (
    <Text color={isSelected ? "black" : "cyan"} backgroundColor={isSelected ? "cyan" : undefined} bold>
      {`  ${label}  `}
    </Text>
  );
}

export function Menu({ projects, onSelect }: { projects: ProjectAudit[]; onSelect: (action: MenuAction) => void }) {
  const total = projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
  const start = projects.map((p) => p.report.spanStart).filter(Boolean).sort()[0];
  const end = projects
    .map((p) => p.report.spanEnd)
    .filter(Boolean)
    .sort()
    .at(-1);
  const range = start && end ? `${start} → ${end}` : "no dated activity";

  const items = [
    { key: "list", label: "Browse projects", value: "list" as const },
    { key: "aggregate", label: "All projects (aggregate)", value: "aggregate" as const },
    { key: "quit", label: "Quit", value: "quit" as const },
  ];

  return (
    <Box flexDirection="column">
      <Banner />
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text bold color="cyan">
            {projects.length}
          </Text>
          <Text dimColor> projects · </Text>
          <Text bold>{usd(total)}</Text>
          <Text dimColor> API-equivalent</Text>
        </Text>
        <Text dimColor>{range}</Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} indicatorComponent={Indicator} itemComponent={Button} />
    </Box>
  );
}
