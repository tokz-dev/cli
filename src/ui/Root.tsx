import { useEffect, useState } from "react";
import { Box, Text, useApp } from "ink";
import { loadAllAgents } from "../agents/index.js";
import type { AgentData } from "../agents/types.js";
import type { LoadProgress } from "../projects.js";
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

// Loads every detected agent's data with a live progress bar, then hands off to the App.
export function Root() {
  const { exit } = useApp();
  const [agents, setAgents] = useState<AgentData[] | undefined>();
  const [agentName, setAgentName] = useState("");
  const [progress, setProgress] = useState<LoadProgress>({ parsed: 0, total: 0 });
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => f + 1), 80);
    loadAllAgents(undefined, (agent, p) => {
      setAgentName(agent);
      setProgress(p);
    })
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => clearInterval(timer));
    return () => clearInterval(timer);
  }, []);

  const empty = agents !== undefined && !agents.some((a) => a.projects.length > 0);
  useEffect(() => {
    if (empty) exit();
  }, [empty, exit]);

  if (!agents) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Banner subtitle="where your agents' tokens and dollars go · 100% offline" />
        <Box flexDirection="column">
          <Text>
            <Text color={theme.accent}>{SPINNER[frame % SPINNER.length]}</Text> Parsing
            {agentName ? ` ${agentName}` : ""}…{" "}
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

  if (empty) return <Text>No agent usage data found (Claude Code, Codex, OpenCode…).</Text>;
  return <App agents={agents} />;
}
