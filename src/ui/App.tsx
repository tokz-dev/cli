import { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { aggregate } from "../projects.js";
import { Menu, type MenuAction } from "./Menu.js";
import { ProjectList } from "./ProjectList.js";
import { Dashboard } from "./Dashboard.js";

export type View = "menu" | "list" | "project" | "aggregate";

const HINTS: Record<View, string> = {
  menu: "↑↓ navigate · ⏎ select · q quit",
  list: "↑↓ navigate · ⏎ open · esc back · q quit",
  project: "1–4 switch tab · esc back · q quit",
  aggregate: "1–4 switch tab · esc back · q quit",
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
  const [selected, setSelected] = useState(initialSelected);

  useInput((input, key) => {
    if (input === "q") exit();
    if (key.escape) {
      if (view === "project") setView("list");
      else if (view === "list" || view === "aggregate") setView("menu");
    }
  });

  if (projects.length === 0) return <Text>No Claude Code transcripts found.</Text>;

  let content: React.ReactNode;
  if (view === "menu") {
    content = (
      <Menu
        projects={projects}
        onSelect={(action: MenuAction) => {
          if (action === "quit") exit();
          else setView(action);
        }}
      />
    );
  } else if (view === "aggregate") {
    content = <Dashboard project={{ id: "__all__", name: "All projects", report: aggregate(projects) }} />;
  } else if (view === "project") {
    content = <Dashboard project={projects[selected]} />;
  } else {
    content = (
      <ProjectList
        projects={projects}
        onSelect={(i) => {
          setSelected(i);
          setView("project");
        }}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {content}
      </Box>
      <Box paddingX={1}>
        <Text dimColor>{HINTS[view]}</Text>
      </Box>
    </Box>
  );
}
