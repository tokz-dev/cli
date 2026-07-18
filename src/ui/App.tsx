import { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentData } from "../agents/types.js";
import type { ProjectAudit } from "../projects.js";
import { aggregate, applyTimeframe } from "../projects.js";
import { nextTimeframe, timeframeLabel, timeframeRange, type TimeframeId } from "../timeframe.js";
import { AgentPicker } from "./AgentPicker.js";
import { Menu, type MenuAction } from "./Menu.js";
import { ProjectList } from "./ProjectList.js";
import { Dashboard } from "./Dashboard.js";
import { HelpOverlay } from "./HelpOverlay.js";

export type View = "agents" | "menu" | "list" | "project" | "aggregate";

const HINTS: Record<View, string> = {
  agents: "↑↓ navigate · ⏎ select · ? help · q quit",
  menu: "↑↓ navigate · ⏎ select · esc agents · ? help · q quit",
  list: "↑↓ move · ⏎ open · / filter · s sort · a all · esc back · ? help · q quit",
  project: "1–6 ←→ tabs · esc back · ? help · q quit",
  aggregate: "1–6 ←→ tabs · esc back · ? help · q quit",
};

/** Wrap a bare project list (tests, legacy callers) as a single Claude Code agent. */
function wrapProjects(projects: ProjectAudit[]): AgentData[] {
  return [
    {
      adapter: {
        id: "claude",
        name: "Claude Code",
        supported: true,
        detect: async () => true,
        loadProjects: async () => projects,
      },
      detected: true,
      projects,
    },
  ];
}

export function App({
  agents,
  projects,
  initialView,
  initialSelected = 0,
}: {
  agents?: AgentData[];
  projects?: ProjectAudit[];
  initialView?: View;
  initialSelected?: number;
}) {
  const { exit } = useApp();
  const rawAgents = useMemo(() => agents ?? wrapProjects(projects ?? []), [agents, projects]);
  // When more than one agent has data, prepend a synthetic "All agents" entry
  // that merges every agent's projects, so its aggregate is the cross-agent
  // total and its project list spans every agent.
  const agentList = useMemo(() => {
    const withData = rawAgents.filter((a) => a.projects.length > 0);
    if (withData.length <= 1) return rawAgents;
    const combined: AgentData = {
      adapter: {
        id: "__all_agents__",
        name: "All agents",
        supported: true,
        detect: async () => true,
        loadProjects: async () => [],
      },
      detected: true,
      projects: withData.flatMap((a) => a.projects),
    };
    return [combined, ...rawAgents];
  }, [rawAgents]);
  const multiAgent = agentList.length > 1;
  const firstWithData = Math.max(0, agentList.findIndex((a) => a.projects.length > 0));
  const [agentIdx, setAgentIdx] = useState(firstWithData);
  const [view, setView] = useState<View>(initialView ?? (multiAgent ? "agents" : "menu"));
  const [aggFrom, setAggFrom] = useState<View>("menu");
  const activeProjects = agentList[agentIdx]?.projects ?? [];
  const [selected, setSelected] = useState<ProjectAudit | undefined>(
    activeProjects[initialSelected],
  );
  const [help, setHelp] = useState(false);
  const [filterCapture, setFilterCapture] = useState(false);
  const [timeframe, setTimeframe] = useState<TimeframeId>("30d");
  const scoped = useMemo(
    () => applyTimeframe(activeProjects, timeframeRange(timeframe)),
    [activeProjects, timeframe],
  );
  const totals = useMemo(() => aggregate(scoped), [scoped]);
  const activeAdapter = agentList[agentIdx]?.adapter;
  const agentName = activeAdapter ? activeAdapter.name + (activeAdapter.estimated ? " (estimated)" : "") : "";

  useInput((input, key) => {
    if (help) {
      setHelp(false);
      return;
    }
    // While the list's filter input is live, don't steal its keystrokes.
    if (filterCapture) return;
    if (input === "q") exit();
    if (input === "?") setHelp(true);
    if (input === "t" && view !== "agents") setTimeframe((tf) => nextTimeframe(tf));
    if (key.escape) {
      if (view === "project") setView("list");
      else if (view === "aggregate") setView(aggFrom);
      else if (view === "list") setView("menu");
      else if (view === "menu" && multiAgent) setView("agents");
    }
  });

  const anyData = agentList.some((a) => a.projects.length > 0);
  if (!anyData) return <Text>No agent usage data found (Claude Code, Codex, OpenCode…).</Text>;

  const tfLabel = timeframeLabel(timeframe);
  let content: React.ReactNode;
  if (help) {
    content = <HelpOverlay />;
  } else if (view === "agents") {
    content = (
      <AgentPicker
        agents={agentList}
        onSelect={(i) => {
          setAgentIdx(i);
          setSelected(undefined);
          setView("menu");
        }}
      />
    );
  } else if (view === "menu") {
    content = (
      <Menu
        projects={scoped}
        totals={totals}
        agentName={agentName}
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
        project={{
          id: "__all__",
          name: `All ${agentName} projects`,
          label: `All ${agentName} projects`,
          report: totals,
        }}
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
        agentName={agentName}
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
          ) : view === "agents" ? (
            HINTS.agents
          ) : (
            <>
              <Text color="yellow">⏱ {tfLabel}</Text>
              {" · t cycle · "}
              {HINTS[view]}
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
}
