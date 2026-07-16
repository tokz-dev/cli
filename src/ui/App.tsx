import { useState } from "react";
import { Text, useApp, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { aggregate } from "../projects.js";
import { Menu, type MenuAction } from "./Menu.js";
import { ProjectList } from "./ProjectList.js";
import { Dashboard } from "./Dashboard.js";

export type View = "menu" | "list" | "project" | "aggregate";

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

  if (view === "menu") {
    return (
      <Menu
        projects={projects}
        onSelect={(action: MenuAction) => {
          if (action === "quit") exit();
          else setView(action);
        }}
      />
    );
  }

  if (view === "aggregate") {
    return <Dashboard project={{ id: "__all__", name: "All projects", report: aggregate(projects) }} />;
  }

  if (view === "project") {
    return <Dashboard project={projects[selected]} />;
  }

  return (
    <ProjectList
      projects={projects}
      onSelect={(i) => {
        setSelected(i);
        setView("project");
      }}
    />
  );
}
