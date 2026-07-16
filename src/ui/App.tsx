import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { aggregate } from "../projects.js";
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
  const totals = useMemo(() => aggregate(projects), [projects]);

  useInput((input, key) => {
    if (help) {
      setHelp(false);
      return;
    }
    // While the list's filter input is live, don't steal its keystrokes.
    if (filterCapture) return;
    if (input === "q") exit();
    if (input === "?") setHelp(true);
    if (key.escape) {
      if (view === "project") setView("list");
      else if (view === "aggregate") setView(aggFrom);
      else if (view === "list") setView("menu");
    }
  });

  if (projects.length === 0) return <Text>No Claude Code transcripts found.</Text>;

  let content: React.ReactNode;
  if (help) {
    content = <HelpOverlay />;
  } else if (view === "menu") {
    content = (
      <Menu
        projects={projects}
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
    content = <Dashboard project={{ id: "__all__", name: "All projects", label: "All projects", report: totals }} />;
  } else if (view === "project" && selected) {
    content = <Dashboard project={selected} />;
  } else {
    content = (
      <ProjectList
        projects={projects}
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
        <Text dimColor>{help ? "any key to close help" : HINTS[view]}</Text>
      </Box>
    </Box>
  );
}
