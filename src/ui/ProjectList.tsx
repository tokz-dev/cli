import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ProjectAudit } from "../projects.js";
import { usd } from "../format.js";
import { bar } from "./bars.js";
import { Banner } from "./Banner.js";

const NAME_W = 40;
const COST_W = 11;
const BAR_W = 18;

function shorten(p: string): string {
  const clean = p.replace(/\\/g, "/");
  return clean.length > NAME_W ? "…" + clean.slice(-(NAME_W - 1)) : clean;
}

function Indicator({ isSelected }: { isSelected?: boolean }) {
  return <Text color="cyan">{isSelected ? "▸ " : "  "}</Text>;
}

function Item({ isSelected, label }: { isSelected?: boolean; label: string }) {
  return (
    <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
      {label}
    </Text>
  );
}

export function ProjectList({ projects, onSelect }: { projects: ProjectAudit[]; onSelect: (index: number) => void }) {
  const total = projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
  const max = Math.max(0, ...projects.map((p) => p.report.totalCostUsd));

  const items = projects.map((p, i) => ({
    key: p.id,
    value: i,
    label:
      shorten(p.name).padEnd(NAME_W) +
      usd(p.report.totalCostUsd).padStart(COST_W) +
      "  " +
      bar(p.report.totalCostUsd, max, BAR_W),
  }));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Banner subtitle={`${projects.length} projects · ${usd(total)} API-equivalent · offline`} />

      <Box>
        <Text dimColor>{"  " + "PROJECT".padEnd(NAME_W) + "COST".padStart(COST_W) + "  SHARE"}</Text>
      </Box>

      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
        <SelectInput
          items={items}
          limit={items.length}
          onSelect={(item) => onSelect(item.value as number)}
          indicatorComponent={Indicator}
          itemComponent={Item}
        />
      </Box>
    </Box>
  );
}
