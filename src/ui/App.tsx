import { useState } from "react";
import { Text, useApp, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { ProjectList } from "./ProjectList.js";
import { Dashboard } from "./Dashboard.js";

export function App({ projects, initialSelected = null }: { projects: ProjectAudit[]; initialSelected?: number | null }) {
  const { exit } = useApp();
  const [selected, setSelected] = useState<number | null>(initialSelected);
  useInput((input, key) => {
    if (input === "q") exit();
    if (key.escape) setSelected(null);
  });
  if (projects.length === 0) return <Text>No Claude Code transcripts found.</Text>;
  return selected === null ? (
    <ProjectList projects={projects} onSelect={setSelected} />
  ) : (
    <Dashboard project={projects[selected]} />
  );
}
