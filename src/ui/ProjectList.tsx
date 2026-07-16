import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { usd, relativeDate } from "../format.js";
import { bar } from "./bars.js";
import { theme } from "./theme.js";

const NAME_W = 38;
const COST_W = 10;
const SESS_W = 6;
const WHEN_W = 11;
const BAR_W = 14;
const VISIBLE = 14;

export type SortMode = "cost" | "recent" | "name";
const SORT_CYCLE: SortMode[] = ["cost", "recent", "name"];

function shorten(p: string): string {
  const clean = p.replace(/\\/g, "/");
  return clean.length > NAME_W ? "…" + clean.slice(-(NAME_W - 1)) : clean;
}

function sortProjects(projects: ProjectAudit[], mode: SortMode): ProjectAudit[] {
  const copy = [...projects];
  if (mode === "cost") copy.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  if (mode === "recent") copy.sort((a, b) => (b.report.spanEnd ?? "").localeCompare(a.report.spanEnd ?? ""));
  if (mode === "name") copy.sort((a, b) => a.name.localeCompare(b.name));
  return copy;
}

export function ProjectList({
  projects,
  onSelect,
  onFilteringChange,
}: {
  projects: ProjectAudit[];
  onSelect: (project: ProjectAudit) => void;
  onFilteringChange?: (filtering: boolean) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFilteringRaw] = useState(false);
  const [sort, setSort] = useState<SortMode>("cost");
  const setFiltering = (v: boolean) => {
    setFilteringRaw(v);
    onFilteringChange?.(v);
  };

  const rows = useMemo(() => {
    const sorted = sortProjects(projects, sort);
    if (!filter) return sorted;
    const q = filter.toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, sort, filter]);

  const clamped = Math.min(cursor, Math.max(0, rows.length - 1));

  useInput((input, key) => {
    if (filtering) {
      if (key.return) setFiltering(false);
      else if (key.escape) {
        setFiltering(false);
        setFilter("");
      } else if (key.backspace || key.delete) setFilter((f) => f.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setFilter((f) => f + input);
      setCursor(0);
      return;
    }
    if (input === "/") {
      setFiltering(true);
      return;
    }
    if (input === "s") {
      setSort((m) => SORT_CYCLE[(SORT_CYCLE.indexOf(m) + 1) % SORT_CYCLE.length]);
      setCursor(0);
      return;
    }
    if (key.upArrow) setCursor(() => Math.max(0, clamped - 1));
    if (key.downArrow) setCursor(() => Math.min(rows.length - 1, clamped + 1));
    if (key.return && rows[clamped]) onSelect(rows[clamped]);
  });

  const total = projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
  const max = Math.max(0, ...projects.map((p) => p.report.totalCostUsd));
  const offset = Math.max(0, Math.min(clamped - Math.floor(VISIBLE / 2), rows.length - VISIBLE));
  const visible = rows.slice(offset, offset + VISIBLE);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.accent}>
          Projects
        </Text>
        <Text dimColor>
          {rows.length}
          {filter ? `/${projects.length}` : ""} projects · {usd(total)} total · sorted by {sort}
          {filtering || filter ? (
            <Text>
              {" · filter: "}
              <Text color={theme.warn}>{filter || "…"}</Text>
              {filtering ? <Text color={theme.warn}>▌</Text> : null}
            </Text>
          ) : null}
        </Text>
      </Box>

      <Text dimColor>
        {"  " +
          "PROJECT".padEnd(NAME_W) +
          "SESS".padStart(SESS_W) +
          "LAST".padStart(WHEN_W) +
          "COST".padStart(COST_W) +
          "  SHARE"}
      </Text>

      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
        {rows.length === 0 ? <Text dimColor>no projects match "{filter}"</Text> : null}
        {visible.map((p, i) => {
          const idx = offset + i;
          const selected = idx === clamped;
          return (
            <Text key={p.id} color={selected ? theme.accent : undefined} bold={selected}>
              {(selected ? "▸ " : "  ") +
                shorten(p.name).padEnd(NAME_W) +
                String(p.report.sessionCount).padStart(SESS_W) +
                relativeDate(p.report.spanEnd).padStart(WHEN_W) +
                usd(p.report.totalCostUsd).padStart(COST_W) +
                "  " +
                bar(p.report.totalCostUsd, max, BAR_W)}
            </Text>
          );
        })}
        {rows.length > VISIBLE ? (
          <Text dimColor>
            … {offset + VISIBLE < rows.length ? `${rows.length - offset - VISIBLE} below` : ""}
            {offset > 0 ? ` · ${offset} above` : ""}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
