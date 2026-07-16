import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { usd, relativeDate } from "../format.js";
import { bar } from "./bars.js";
import { theme } from "./theme.js";
import { useTerminalSize } from "./useTerminalSize.js";

const COST_W = 10;
const SESS_W = 6;
const WHEN_W = 11;
const BAR_W = 14;

export type SortMode = "cost" | "recent" | "name";
const SORT_CYCLE: SortMode[] = ["cost", "recent", "name"];

function sortProjects(projects: ProjectAudit[], mode: SortMode): ProjectAudit[] {
  const copy = [...projects];
  if (mode === "cost") copy.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  if (mode === "recent") copy.sort((a, b) => (b.report.spanEnd ?? "").localeCompare(a.report.spanEnd ?? ""));
  if (mode === "name") copy.sort((a, b) => a.label.localeCompare(b.label));
  return copy;
}

/** Basename plus a dim parent hint when two projects share a basename. */
function displayLabels(projects: ProjectAudit[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const p of projects) counts.set(p.label, (counts.get(p.label) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of projects) {
    if ((counts.get(p.label) ?? 0) > 1) {
      const parts = p.name.replace(/\\/g, "/").split("/").filter(Boolean);
      const parent = parts.at(-2);
      out.set(p.id, parent ? `${p.label} (${parent})` : p.label);
    } else {
      out.set(p.id, p.label);
    }
  }
  return out;
}

export function ProjectList({
  projects,
  onSelect,
  onAggregate,
  onFilteringChange,
}: {
  projects: ProjectAudit[];
  onSelect: (project: ProjectAudit) => void;
  onAggregate: () => void;
  onFilteringChange?: (filtering: boolean) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [filtering, setFilteringRaw] = useState(false);
  const [sort, setSort] = useState<SortMode>("cost");
  const { cols, rows } = useTerminalSize();
  const setFiltering = (v: boolean) => {
    setFilteringRaw(v);
    onFilteringChange?.(v);
  };

  const labels = useMemo(() => displayLabels(projects), [projects]);

  const filtered = useMemo(() => {
    const sorted = sortProjects(projects, sort);
    if (!filter) return sorted;
    const q = filter.toLowerCase();
    return sorted.filter(
      (p) => p.label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
    );
  }, [projects, sort, filter]);

  // Row 0 is the pinned "All projects" aggregate; projects start at 1.
  const rowCount = filtered.length + (filter ? 0 : 1);
  const clamped = Math.min(cursor, Math.max(0, rowCount - 1));
  const pinnedShown = !filter;

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
    if (input === "a") {
      onAggregate();
      return;
    }
    if (input === "s") {
      setSort((m) => SORT_CYCLE[(SORT_CYCLE.indexOf(m) + 1) % SORT_CYCLE.length]);
      setCursor(0);
      return;
    }
    if (key.upArrow) setCursor(() => Math.max(0, clamped - 1));
    if (key.downArrow) setCursor(() => Math.min(rowCount - 1, clamped + 1));
    if (key.return) {
      if (pinnedShown && clamped === 0) onAggregate();
      else {
        const p = filtered[clamped - (pinnedShown ? 1 : 0)];
        if (p) onSelect(p);
      }
    }
  });

  // Responsive columns: drop SHARE, then LAST, then SESS as the terminal narrows.
  const overhead = 8; // outer padding + border + inner padding
  const avail = cols - overhead;
  const showBar = avail >= 24 + SESS_W + WHEN_W + COST_W + 2 + 8;
  const showWhen = avail >= 20 + SESS_W + WHEN_W + COST_W;
  const showSess = avail >= 16 + SESS_W + COST_W;
  const fixed = COST_W + (showSess ? SESS_W : 0) + (showWhen ? WHEN_W : 0) + (showBar ? BAR_W + 2 : 0);
  const nameW = Math.max(10, Math.min(42, avail - fixed - 2));
  const barW = showBar ? Math.min(BAR_W + Math.max(0, avail - fixed - 2 - nameW), 30) : 0;
  const visibleRows = Math.max(4, Math.min(20, rows - 10));

  const clip = (s: string) => (s.length > nameW ? s.slice(0, nameW - 1) + "…" : s);

  const total = projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
  const max = Math.max(0, ...projects.map((p) => p.report.totalCostUsd));

  const projCursor = clamped - (pinnedShown ? 1 : 0);
  const offset = Math.max(0, Math.min(projCursor - Math.floor(visibleRows / 2), filtered.length - visibleRows));
  const visible = filtered.slice(offset, offset + visibleRows);

  const line = (label: string, sess: string, when: string, cost: string, share: string, selected: boolean) =>
    (selected ? "▸ " : "  ") +
    clip(label).padEnd(nameW) +
    (showSess ? sess.padStart(SESS_W) : "") +
    (showWhen ? when.padStart(WHEN_W) : "") +
    cost.padStart(COST_W) +
    (showBar ? "  " + share : "");

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text bold color={theme.accent}>
          Projects
        </Text>
        <Text dimColor>
          {filtered.length}
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
          "PROJECT".padEnd(nameW) +
          (showSess ? "SESS".padStart(SESS_W) : "") +
          (showWhen ? "LAST".padStart(WHEN_W) : "") +
          "COST".padStart(COST_W) +
          (showBar ? "  SHARE" : "")}
      </Text>

      <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1}>
        {pinnedShown ? (
          <Text color={clamped === 0 ? theme.accent : undefined} bold={clamped === 0}>
            {line("⊕ All projects", String(projects.reduce((s, p) => s + p.report.sessionCount, 0)), "", usd(total), "", clamped === 0)}
          </Text>
        ) : null}
        {filtered.length === 0 ? <Text dimColor>no projects match "{filter}"</Text> : null}
        {visible.map((p, i) => {
          const idx = offset + i;
          const selected = idx === projCursor;
          return (
            <Text key={p.id} color={selected ? theme.accent : undefined} bold={selected}>
              {line(
                labels.get(p.id) ?? p.label,
                String(p.report.sessionCount),
                relativeDate(p.report.spanEnd),
                usd(p.report.totalCostUsd),
                bar(p.report.totalCostUsd, max, barW),
                selected,
              )}
            </Text>
          );
        })}
        {filtered.length > visibleRows ? (
          <Text dimColor>
            …{offset + visibleRows < filtered.length ? ` ${filtered.length - offset - visibleRows} below` : ""}
            {offset > 0 ? ` · ${offset} above` : ""}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
