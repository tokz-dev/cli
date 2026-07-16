import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import { loadProjects, type LoadProgress, type ProjectAudit } from "../projects.js";
import { App } from "./App.js";
import { Banner } from "./Banner.js";
import { theme } from "./theme.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function ProgressBar({ done, total, width = 30 }: { done: number; total: number; width?: number }) {
  const filled = total > 0 ? Math.round((done / total) * width) : 0;
  return (
    <Text>
      <Text color={theme.accent}>{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(width - filled)}</Text>
    </Text>
  );
}

// Loads all projects with a live progress bar, then hands off to the App.
export function Root() {
  const { exit } = useApp();
  const [projects, setProjects] = useState<ProjectAudit[] | undefined>();
  const [progress, setProgress] = useState<LoadProgress>({ parsed: 0, total: 0 });
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => f + 1), 80);
    loadProjects(undefined, setProgress)
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => clearInterval(timer));
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (projects && projects.length === 0) exit();
  }, [projects, exit]);

  if (!projects) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Banner subtitle="where your agent's tokens and dollars go · 100% offline" />
        <Box flexDirection="column">
          <Text>
            <Text color={theme.accent}>{SPINNER[frame % SPINNER.length]}</Text> Parsing transcripts…{" "}
            <Text bold>
              {progress.parsed}/{progress.total || "?"}
            </Text>
          </Text>
          <ProgressBar done={progress.parsed} total={progress.total} />
          {progress.currentProject ? (
            <Text dimColor>{progress.currentProject.replace(/\\/g, "/")}</Text>
          ) : null}
        </Box>
      </Box>
    );
  }

  if (projects.length === 0) return <Text>No Claude Code transcripts found under ~/.claude/projects.</Text>;
  return <App projects={projects} />;
}
