# Tokz Interactive TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive Ink-based TUI to `tokz` — a project browser that drills into per-project tabbed dashboards with Unicode bar charts — while keeping the existing static/JSON output intact.

**Architecture:** A new pure data layer (`loadProjects`) groups transcripts per project and reuses the existing deduped parser + `buildReport`. Ink components (`App` → `ProjectList` → `Dashboard`) render the UI; charts are a pure `bar()`/`bars()` string helper wrapped by a `<BarChart>` component. `cli.ts` launches the TUI on bare `tokz` when stdout is a TTY, else falls back to the current static aggregate.

**Tech Stack:** TypeScript ESM, Ink (React for terminal), ink-select-input, ink-testing-library, existing commander/zod/tinyglobby/cli-table3/picocolors.

## Global Constraints

- `"type": "module"` ESM throughout; relative imports use `.js` extensions (incl. `.tsx` files imported as `.js`).
- Node `>=22.0.0`.
- NEVER call the network. Charts are Unicode (`█`) only — no image/chart libs.
- Counting correctness is fixed: reuse `parseTranscript` (deduped by message.id + tool_use id, shared sets across all files) and `buildReport`. TUI must NOT fork counting logic.
- Static + JSON output paths (`report.ts`, `tokz audit`, `--json`) stay byte-for-byte unchanged.
- Ink is loaded via dynamic `import()` inside the TUI path only, so `tokz audit` stays fast.
- Commit after every task with the message given in that task.

---

### Task 1: Dependencies + JSX config

**Files:**
- Modify: `package.json`, `tsconfig.json`

**Interfaces:**
- Produces: a repo where `.tsx` files compile (esbuild via tsup + tsc typecheck), and `react`/`ink`/`ink-select-input` are importable.

- [ ] **Step 1: Add deps to package.json**

Add to `dependencies`:
```json
    "ink": "^5.0.1",
    "ink-select-input": "^6.0.0",
    "react": "^18.3.1"
```
Add to `devDependencies`:
```json
    "@types/react": "^18.3.12",
    "ink-testing-library": "^4.0.0"
```

- [ ] **Step 2: Enable JSX in tsconfig.json**

Add to `compilerOptions`:
```json
    "jsx": "react-jsx",
```

- [ ] **Step 3: Install and verify**

Run: `npm install && npx tsc --noEmit`
Expected: install succeeds; tsc exits 0 (no source uses JSX yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json && git commit -m "chore: add ink TUI dependencies and enable jsx"
```

---

### Task 2: Shared formatters + chart primitives

**Files:**
- Create: `src/format.ts`, `src/ui/bars.ts`
- Modify: `src/report.ts` (import formatters instead of defining them)
- Test: `test/bars.test.ts`

**Interfaces:**
- Produces: `usd(n: number): string`, `tok(n: number): string` in `src/format.ts`; `bar(value: number, max: number, width?: number): string` and `bars(rows: BarRow[], width?: number): string[]` with `interface BarRow { label: string; value: number }` in `src/ui/bars.ts`.

- [ ] **Step 1: Write the failing test**

`test/bars.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { bar, bars } from "../src/ui/bars.js";

describe("bar", () => {
  it("fills proportionally to max, min one block for nonzero, empty for zero", () => {
    expect(bar(10, 10, 10)).toBe("█".repeat(10));
    expect(bar(5, 10, 10)).toBe("█".repeat(5));
    expect(bar(0, 10, 10)).toBe("");
    expect(bar(1, 1000, 10)).toBe("█"); // rounds to 0 but clamped to 1
    expect(bar(5, 0, 10)).toBe(""); // max 0 -> empty, no divide-by-zero
  });
});

describe("bars", () => {
  it("pads labels to equal width and scales each row", () => {
    const out = bars([
      { label: "a", value: 10 },
      { label: "bbb", value: 5 },
    ], 10);
    expect(out[0]).toBe("a   " + "█".repeat(10));
    expect(out[1]).toBe("bbb " + "█".repeat(5));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bars.test.ts`
Expected: FAIL — cannot resolve `../src/ui/bars.js`.

- [ ] **Step 3: Write implementation**

`src/format.ts`:
```ts
export const usd = (n: number): string => `$${n.toFixed(2)}`;
export const tok = (n: number): string => n.toLocaleString("en-US");
```

`src/ui/bars.ts`:
```ts
export interface BarRow {
  label: string;
  value: number;
}

export function bar(value: number, max: number, width = 20): string {
  if (max <= 0 || value <= 0) return "";
  return "█".repeat(Math.max(1, Math.round((value / max) * width)));
}

export function bars(rows: BarRow[], width = 20): string[] {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const labelW = Math.max(0, ...rows.map((r) => r.label.length));
  return rows.map((r) => `${r.label.padEnd(labelW)} ${bar(r.value, max, width)}`);
}
```

- [ ] **Step 4: Refactor report.ts to use shared formatters**

In `src/report.ts`, replace the local definitions:
```ts
const usd = (n: number) => `$${n.toFixed(2)}`;
const tok = (n: number) => n.toLocaleString("en-US");
```
with an import at the top (after the existing imports):
```ts
import { usd, tok } from "./format.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run test/bars.test.ts test/report.test.ts`
Expected: PASS (bars + existing report test still green).

- [ ] **Step 6: Commit**

```bash
git add src/format.ts src/ui/bars.ts src/report.ts test/bars.test.ts && git commit -m "feat: shared usd/tok formatters and unicode bar chart primitives"
```

---

### Task 3: Project data layer

**Files:**
- Create: `src/projects.ts`
- Test: `test/projects.test.ts`

**Interfaces:**
- Consumes: `parseTranscript(file, seenMessageIds, seenToolIds)` (transcript.ts), `buildReport` (attribute.ts), `findMcpServers` (mcp.ts), `sanitizeProjectPath` (discover.ts), `AuditReport` (types.ts).
- Produces: `interface ProjectAudit { id: string; name: string; realPath?: string; report: AuditReport }` and `loadProjects(home?: string): Promise<ProjectAudit[]>` — one entry per `~/.claude/projects/<dir>`, sorted by `report.totalCostUsd` descending, with real path + MCP servers resolved from `~/.claude.json` when matchable.

- [ ] **Step 1: Write the failing test**

`test/projects.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjects } from "../src/projects.js";

function assistantLine(model: string, output: number, msgId: string, tool?: string) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T00:00:00Z",
    message: {
      id: msgId,
      model,
      usage: { input_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: output },
      content: tool ? [{ type: "tool_use", id: "toolu_" + msgId, name: tool }] : [],
    },
  });
}

describe("loadProjects", () => {
  it("groups per project dir, resolves real path + servers, sorts by cost", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-lp-"));
    const realPath = "/home/me/big";
    const sanBig = realPath.replace(/[^a-zA-Z0-9]/g, "-"); // -home-me-big
    const bigDir = join(home, ".claude", "projects", sanBig);
    const smallDir = join(home, ".claude", "projects", "-home-me-small");
    mkdirSync(bigDir, { recursive: true });
    mkdirSync(smallDir, { recursive: true });
    // big project: large output => higher cost
    writeFileSync(join(bigDir, "s.jsonl"), assistantLine("claude-opus-4-8", 1_000_000, "msg_big", "mcp__ctx__q"));
    // small project: tiny output
    writeFileSync(join(smallDir, "s.jsonl"), assistantLine("claude-opus-4-8", 10, "msg_small"));
    // config: real path + one MCP server for big project
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ projects: { [realPath]: { mcpServers: { ctx: { command: "npx" } } } } }),
    );

    const projects = await loadProjects(home);
    expect(projects).toHaveLength(2);
    expect(projects[0].id).toBe(sanBig); // highest cost first
    expect(projects[0].name).toBe(realPath); // real path resolved
    expect(projects[0].report.servers.map((s) => s.name)).toEqual(["ctx"]);
    expect(projects[0].report.servers[0].unused).toBe(false); // ctx was called
    expect(projects[1].name).toBe("-home-me-small"); // no config match -> id
    expect(projects[1].report.servers).toEqual([]);
  });

  it("returns empty array when projects dir is missing", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-lp-empty-"));
    expect(await loadProjects(home)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/projects.test.ts`
Expected: FAIL — cannot resolve `../src/projects.js`.

- [ ] **Step 3: Write implementation**

`src/projects.ts`:
```ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, sep } from "node:path";
import { glob } from "tinyglobby";
import { buildReport } from "./attribute.js";
import { sanitizeProjectPath } from "./discover.js";
import { findMcpServers } from "./mcp.js";
import { parseTranscript } from "./transcript.js";
import type { AuditReport } from "./types.js";

export interface ProjectAudit {
  id: string;
  name: string;
  realPath?: string;
  report: AuditReport;
}

async function realPathsBySanitized(home: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const cfg = JSON.parse(await readFile(join(home, ".claude.json"), "utf8"));
    const projects = cfg?.projects;
    if (projects && typeof projects === "object") {
      for (const p of Object.keys(projects)) map.set(sanitizeProjectPath(p), p);
    }
  } catch {
    /* missing/invalid config: no real paths */
  }
  return map;
}

export async function loadProjects(home: string = homedir()): Promise<ProjectAudit[]> {
  const root = join(home, ".claude", "projects");
  const files = await glob(["**/*.jsonl"], { cwd: root, absolute: true }).catch(() => []);
  if (files.length === 0) return [];

  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const dir = relative(root, f).split(sep)[0];
    const list = byDir.get(dir) ?? [];
    list.push(f);
    byDir.set(dir, list);
  }

  const realMap = await realPathsBySanitized(home);
  const seenMessageIds = new Set<string>();
  const seenToolIds = new Set<string>();

  const out: ProjectAudit[] = [];
  for (const [dir, dirFiles] of byDir) {
    const sessions = await Promise.all(
      dirFiles.map((f) => parseTranscript(f, seenMessageIds, seenToolIds)),
    );
    const realPath = realMap.get(dir);
    const servers = realPath ? await findMcpServers(realPath, home) : [];
    out.push({ id: dir, name: realPath ?? dir, realPath, report: buildReport(sessions, servers) });
  }

  out.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/projects.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/projects.ts test/projects.test.ts && git commit -m "feat: per-project data layer with real-path and server resolution"
```

---

### Task 4: Ink components (BarChart, ProjectList, Dashboard)

**Files:**
- Create: `src/ui/BarChart.tsx`, `src/ui/ProjectList.tsx`, `src/ui/Dashboard.tsx`
- Test: `test/ui.test.tsx`

**Interfaces:**
- Consumes: `ProjectAudit` (projects.ts), `AuditReport` (types.ts), `bar` (ui/bars.ts), `usd`/`tok` (format.ts).
- Produces: `<BarChart rows={ChartRow[]} width? />` with `interface ChartRow { label: string; value: number; display?: string; color?: string }`; `<ProjectList projects={ProjectAudit[]} onSelect={(index:number)=>void} />`; `<Dashboard project={ProjectAudit} />`.

- [ ] **Step 1: Write the failing test**

`test/ui.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { BarChart } from "../src/ui/BarChart.js";
import { Dashboard } from "../src/ui/Dashboard.js";
import type { ProjectAudit } from "../src/projects.js";

const project: ProjectAudit = {
  id: "-home-me-proj",
  name: "/home/me/proj",
  realPath: "/home/me/proj",
  report: {
    sessionCount: 2,
    spanDays: 10,
    usageByModel: { "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 500_000, turns: 5 } },
    costByModel: { "claude-opus-4-8": { input: 5, cacheRead: 0, cacheWrite: 0, output: 12.5, total: 17.5 } },
    totalCostUsd: 17.5,
    monthlyProjectionUsd: 52.5,
    toolCalls: { Read: 30, Bash: 12 },
    servers: [{ name: "ctx", source: "x", callsObserved: 0, unused: true }],
  },
};

describe("BarChart", () => {
  it("renders one bar row per entry with display text", () => {
    const { lastFrame } = render(<BarChart rows={[{ label: "opus", value: 10, display: "$10" }]} />);
    expect(lastFrame()).toContain("opus");
    expect(lastFrame()).toContain("█");
    expect(lastFrame()).toContain("$10");
  });
});

describe("Dashboard", () => {
  it("shows header, cost, and overview by default", () => {
    const { lastFrame } = render(<Dashboard project={project} />);
    expect(lastFrame()).toContain("/home/me/proj");
    expect(lastFrame()).toContain("$17.50");
    expect(lastFrame()).toContain("claude-opus-4-8");
  });

  it("switches to Servers tab on '4' and flags UNUSED", () => {
    const { lastFrame, stdin } = render(<Dashboard project={project} />);
    stdin.write("4");
    expect(lastFrame()).toContain("ctx");
    expect(lastFrame()).toContain("UNUSED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui.test.tsx`
Expected: FAIL — cannot resolve `../src/ui/BarChart.js`.

- [ ] **Step 3: Write BarChart**

`src/ui/BarChart.tsx`:
```tsx
import { Box, Text } from "ink";
import { bar } from "./bars.js";

export interface ChartRow {
  label: string;
  value: number;
  display?: string;
  color?: string;
}

export function BarChart({ rows, width = 24 }: { rows: ChartRow[]; width?: number }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const labelW = Math.max(0, ...rows.map((r) => r.label.length));
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => (
        <Text key={i}>
          {r.label.padEnd(labelW)} <Text color={r.color ?? "cyan"}>{bar(r.value, max, width)}</Text>{" "}
          {r.display ?? String(r.value)}
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 4: Write Dashboard**

`src/ui/Dashboard.tsx`:
```tsx
import { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import type { AuditReport } from "../types.js";
import { usd, tok } from "../format.js";
import { BarChart } from "./BarChart.js";

const TABS = ["Overview", "Models", "Tools", "Servers"] as const;

function TabBody({ tab, r }: { tab: number; r: AuditReport }) {
  if (tab === 0) {
    const rows = Object.entries(r.costByModel).map(([m, c]) => ({ label: m, value: c.total, display: usd(c.total) }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no usage</Text>;
  }
  if (tab === 1) {
    const rows = Object.entries(r.usageByModel).map(([m, u]) => ({ label: m, value: u.outputTokens, display: `${tok(u.outputTokens)} out` }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no usage</Text>;
  }
  if (tab === 2) {
    const rows = Object.entries(r.toolCalls)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([n, c]) => ({ label: n, value: c, display: String(c) }));
    return rows.length ? <BarChart rows={rows} /> : <Text dimColor>no tool calls</Text>;
  }
  if (r.servers.length === 0) return <Text dimColor>no MCP servers configured</Text>;
  return (
    <Box flexDirection="column">
      {r.servers.map((s, i) => (
        <Text key={i}>
          {s.name} · {s.callsObserved} calls ·{" "}
          {s.unused ? <Text color="red">UNUSED</Text> : <Text color="green">used</Text>}
        </Text>
      ))}
    </Box>
  );
}

export function Dashboard({ project }: { project: ProjectAudit }) {
  const [tab, setTab] = useState(0);
  useInput((input) => {
    const n = Number.parseInt(input, 10);
    if (n >= 1 && n <= TABS.length) setTab(n - 1);
  });
  const r = project.report;
  return (
    <Box flexDirection="column">
      <Text bold>{project.name}</Text>
      <Text>
        {usd(r.totalCostUsd)} API-equivalent · proj {usd(r.monthlyProjectionUsd)}/mo · {r.sessionCount} sessions · {r.spanDays}d
      </Text>
      <Text dimColor>esc back · q quit · {TABS.map((t, i) => `[${i + 1}]${t}`).join(" ")}</Text>
      <Box marginTop={1}>
        <TabBody tab={tab} r={r} />
      </Box>
    </Box>
  );
}
```

- [ ] **Step 5: Write ProjectList**

`src/ui/ProjectList.tsx`:
```tsx
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { ProjectAudit } from "../projects.js";
import { usd } from "../format.js";
import { bar } from "./bars.js";

function shorten(p: string): string {
  return p.length > 44 ? "…" + p.slice(-43) : p;
}

export function ProjectList({ projects, onSelect }: { projects: ProjectAudit[]; onSelect: (index: number) => void }) {
  const total = projects.reduce((s, p) => s + p.report.totalCostUsd, 0);
  const max = Math.max(0, ...projects.map((p) => p.report.totalCostUsd));
  const items = projects.map((p, i) => ({
    key: p.id,
    label: `${shorten(p.name).padEnd(45)} ${usd(p.report.totalCostUsd).padStart(9)}  ${bar(p.report.totalCostUsd, max, 16)}`,
    value: i,
  }));
  return (
    <Box flexDirection="column">
      <Text bold>
        tokz — {projects.length} projects · {usd(total)} API-equivalent
      </Text>
      <Text dimColor>↑↓ move · ⏎ open · q quit</Text>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value as number)} />
    </Box>
  );
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx vitest run test/ui.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/ui/BarChart.tsx src/ui/Dashboard.tsx src/ui/ProjectList.tsx test/ui.test.tsx && git commit -m "feat: ink components for project list and tabbed dashboard"
```

---

### Task 5: App root + CLI wiring + smoke test

**Files:**
- Create: `src/ui/App.tsx`
- Modify: `src/cli.ts`
- Test: `test/app.test.tsx`

**Interfaces:**
- Consumes: `ProjectAudit` (projects.ts), `ProjectList`, `Dashboard`.
- Produces: `<App projects={ProjectAudit[]} />` — shows `ProjectList`; on select shows that project's `Dashboard`; `esc` returns to the list; `q` quits. `cli.ts` bare command renders `<App>` when stdout is a TTY, else runs the existing static aggregate.

- [ ] **Step 1: Write the failing test**

`test/app.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../src/ui/App.js";
import type { ProjectAudit } from "../src/projects.js";

const mk = (name: string, cost: number): ProjectAudit => ({
  id: name,
  name,
  report: {
    sessionCount: 1,
    spanDays: 1,
    usageByModel: {},
    costByModel: {},
    totalCostUsd: cost,
    monthlyProjectionUsd: cost,
    toolCalls: {},
    servers: [],
  },
});

describe("App", () => {
  it("lists projects then opens a dashboard on Enter", () => {
    const { lastFrame, stdin } = render(<App projects={[mk("/proj-a", 5), mk("/proj-b", 1)]} />);
    expect(lastFrame()).toContain("2 projects");
    stdin.write("\r"); // Enter selects the first (highest-cost) item
    expect(lastFrame()).toContain("/proj-a");
    expect(lastFrame()).toContain("API-equivalent");
  });

  it("shows a message when there are no projects", () => {
    const { lastFrame } = render(<App projects={[]} />);
    expect(lastFrame()).toContain("No Claude Code transcripts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app.test.tsx`
Expected: FAIL — cannot resolve `../src/ui/App.js`.

- [ ] **Step 3: Write App**

`src/ui/App.tsx`:
```tsx
import { useState } from "react";
import { Text, useApp, useInput } from "ink";
import type { ProjectAudit } from "../projects.js";
import { ProjectList } from "./ProjectList.js";
import { Dashboard } from "./Dashboard.js";

export function App({ projects }: { projects: ProjectAudit[] }) {
  const { exit } = useApp();
  const [selected, setSelected] = useState<number | null>(null);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/app.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the bare command in cli.ts**

In `src/cli.ts`, add these imports at the top (keep existing imports):
```ts
import { renderReport } from "./report.js";
```
(already imported — ensure it is). Then add a default (bare) command action AFTER the `audit` command block and BEFORE `program.parseAsync();`:
```ts
program
  .action(async () => {
    if (!process.stdout.isTTY) {
      const transcripts = await findTranscripts(undefined);
      if (transcripts.length === 0) {
        console.error("No Claude Code transcripts found.");
        process.exitCode = 1;
        return;
      }
      const seenMessageIds = new Set<string>();
      const seenToolIds = new Set<string>();
      const sessions = await Promise.all(
        transcripts.map((f) => parseTranscript(f, seenMessageIds, seenToolIds)),
      );
      console.log(renderReport(buildReport(sessions, [])));
      return;
    }
    const { loadProjects } = await import("./projects.js");
    const projects = await loadProjects();
    if (projects.length === 0) {
      console.error("No Claude Code transcripts found.");
      process.exitCode = 1;
      return;
    }
    const [{ render }, React, { App }] = await Promise.all([
      import("ink"),
      import("react"),
      import("./ui/App.js"),
    ]);
    render(React.createElement(App, { projects }));
  });
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: all suites PASS.

- [ ] **Step 7: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc exits 0; tsup builds `dist/cli.js`.

- [ ] **Step 8: Smoke test**

Run (non-TTY fallback): `node dist/cli.js | head -5`
Expected: static aggregate report (piped = not a TTY).

Run (interactive, manual): `node dist/cli.js`
Expected: project list appears; arrow keys move; Enter opens a dashboard; 1–4 switch tabs; esc goes back; q quits. (Skip if running headless; the piped path above covers CI.)

- [ ] **Step 9: Commit**

```bash
git add src/ui/App.tsx src/cli.ts test/app.test.tsx && git commit -m "feat: TUI app root and bare-command launch with non-TTY fallback"
```

---

## Self-review notes

- Spec coverage: Ink stack ✅ (Task 1,4,5), Unicode bars ✅ (Task 2), commands/TTY fallback ✅ (Task 5), `loadProjects` + real-path/server resolution ✅ (Task 3), component tree App/List/Dashboard/BarChart ✅ (Task 4,5), shared format.ts ✅ (Task 2), static+JSON unchanged ✅ (only `report.ts` internal refactor to import formatters, output identical), testing via ink-testing-library ✅ (Task 4,5).
- Deferred per spec YAGNI: live refresh, mouse, daily sparkline, search/filter, TUI export.
- Type consistency: `ProjectAudit` shape identical across Tasks 3–5; `ChartRow`/`BarRow` distinct and each defined where produced; `parseTranscript(file, seenMessageIds, seenToolIds)` signature matches transcript.ts.
- Note: `ink-select-input` label is a plain string, so the per-row cost bar is embedded in the label text (Task 4 ProjectList) rather than a custom item component — keeps v1 simple while still showing inline bars.
