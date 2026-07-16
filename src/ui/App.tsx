import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { aggregate, applyTimeframe } from "../projects.js";
import { nextTimeframe, timeframeLabel, timeframeRange, type TimeframeId } from "../timeframe.js";
import { Menu, type MenuAction } from "./Menu.js";
import { ProjectList } from "./ProjectList.js";
import { Dashboard } from "./Dashboard.js";
import { HelpOverlay } from "./HelpOverlay.js";

export type View = "menu" | "list" | "project" | "aggregate";

const HINTS: Record<View, string> = {
  menu: "↑↓ navigate · ⏎ select · ? help · q quit",
  list: "↑↓ move · ⏎ open · / filter · s sort · a all · esc back · ? help · q quit",
  project: "1–6 ←→ tabs · esc back · ? help · q quit",
  aggregate: "1–6 ←→ tabs · esc back · ? help · q quit",
};

export function App({
  projects,
  initialView = "menu",
  initialSelected = 0,
}: {
  projects: ProjectAudit[];
  initialView?: View;
  initialSelected?: number;
}) {
  const { exit } = useApp();
  const [view, setView] = useState<View>(initialView);
  const [aggFrom, setAggFrom] = useState<View>("menu");
  const [selected, setSelected] = useState<ProjectAudit | undefined>(projects[initialSelected]);
  const [help, setHelp] = useState(false);
  const [filterCapture, setFilterCapture] = useState(false);
  const [timeframe, setTimeframe] = useState<TimeframeId>("all");
  const scoped = useMemo(
    () => applyTimeframe(projects, timeframeRange(timeframe)),
    [projects, timeframe],
  );
  const totals = useMemo(() => aggregate(scoped), [scoped]);

  useInput((input, key) => {
    if (help) {
      setHelp(false);
      return;
    }
    // While the list's filter input is live, don't steal its keystrokes.
    if (filterCapture) return;
    if (input === "q") exit();
    if (input === "?") setHelp(true);
    if (input === "t") setTimeframe((tf) => nextTimeframe(tf));
    if (key.escape) {
      if (view === "project") setView("list");
      else if (view === "aggregate") setView(aggFrom);
      else if (view === "list") setView("menu");
    }
  });

  if (projects.length === 0) return <Text>No Claude Code transcripts found.</Text>;

  const tfLabel = timeframeLabel(timeframe);
  let content: React.ReactNode;
  if (help) {
    content = <HelpOverlay />;
  } else if (view === "menu") {
    content = (
      <Menu
        projects={scoped}
        totals={totals}
        onSelect={(action: MenuAction) => {
          if (action === "quit") exit();
          else {
            if (action === "aggregate") setAggFrom("menu");
            setView(action);
          }
        }}
      />
    );
  } else if (view === "aggregate") {
    content = (
      <Dashboard
        project={{ id: "__all__", name: "All projects", label: "All projects", report: totals }}
        timeframe={tfLabel}
      />
    );
  } else if (view === "project" && selected) {
    const current = scoped.find((p) => p.id === selected.id);
    content = current ? (
      <Dashboard project={current} timeframe={tfLabel} />
    ) : (
      <Box paddingX={1}>
        <Text dimColor>
          {selected.label}: no activity {tfLabel.toLowerCase()} — press t to change the timeframe or
          esc to go back.
        </Text>
      </Box>
    );
  } else {
    content = (
      <ProjectList
        projects={scoped}
        onSelect={(p) => {
          setSelected(p);
          setView("project");
        }}
        onAggregate={() => {
          setAggFrom("list");
          setView("aggregate");
        }}
        onFilteringChange={setFilterCapture}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {content}
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          {help ? (
            "any key to close help"
          ) : (
            <>
              <Text color={timeframe === "all" ? undefined : "yellow"}>⏱ {tfLabel}</Text>
              {" · t cycle · "}
              {HINTS[view]}
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}
