# Tokz Interactive TUI — Design

## Goal

Turn `tokz` from static tables into a good-looking interactive terminal UI: a
project browser that drills into per-project dashboards with Unicode charts. Keep
the existing static/JSON output for scripts and CI.

## Stack

- **Ink** (React for the terminal) — component model fits list → dashboard drill-down.
- `ink-select-input` — arrow-key project list.
- `useInput` — global keys (quit, back, tab switch).
- Charts = **Unicode horizontal bars** (`█`) scaled to the max value, colored via Ink `Text`. No image/chart libs, no network.
- New deps: runtime `react`, `ink`, `ink-select-input`; dev `ink-testing-library`, `@types/react`.

## Commands

| Command | Behavior |
|---|---|
| `tokz` (no args) | Launch interactive TUI (all projects). Non-TTY (piped) → auto-fallback to static `audit --all`. |
| `tokz audit [project]` | Existing static tables (unchanged). |
| `tokz audit --json` | Existing JSON (unchanged). |
| `tokz audit --all` | Existing static aggregate (unchanged). |

`report.ts` (static renderer) stays untouched — it is the non-TTY / `audit` path.

## Data layer — `src/projects.ts`

Current `buildReport` aggregates ALL sessions into one report, losing the
per-project split the browser needs. Add:

```ts
export interface ProjectAudit {
  id: string;        // transcript dir name (sanitized path)
  name: string;      // real path if resolved, else id
  realPath?: string; // resolved from ~/.claude.json projects keys
  report: AuditReport;
}
export function loadProjects(home?: string): Promise<ProjectAudit[]>;
```

Steps:
1. Find all `~/.claude/projects/<dir>/**/*.jsonl`, group by `<dir>` (one project per dir).
2. Build one `AuditReport` per project via existing `buildReport`.
3. Resolve real path + MCP servers: read `~/.claude.json` `projects` keys (real
   paths). For each, compute `sanitizeProjectPath(realPath)` and match to a dir.
   On match, set `realPath`/`name` and pass that project's servers into its report.
   No match → `name = id`, empty servers. Sanitize is lossy (non-alphanumeric → `-`),
   so this forward-match is the only reliable path recovery.
4. Dedup sets (`seenMessageIds`, `seenToolIds`) are shared across ALL files in the
   whole run so cross-project resumed-session copies are not double-counted.
5. Sort by `report.totalCostUsd` descending.

## Component tree — `src/ui/`

```
App.tsx          root: view state (list | project index), useInput global keys
ProjectList.tsx  ink-select-input; rows = name + cost + inline bar; sorted by cost
Dashboard.tsx    per-project tabbed view; tabs switch on 1/2/3/4 and tab key
BarChart.tsx     pure component: rows {label,value,color?} + width → scaled █ bars
format.ts        usd() / tok() (shared with static report)
```

### Screens

- **List:** header with grand total + monthly projection. One row per project:
  name, cost, inline cost bar. `↑↓` move, `⏎` open, `q` quit.
- **Dashboard (per project):** header (cost, monthly projection, span days,
  session count). Tabs:
  - `[1] Overview` — cost-by-model bars + headline stats.
  - `[2] Models` — per-model input / cache read / cache write / output + cost, with bars.
  - `[3] Tools` — top 15 tool calls as bars.
  - `[4] Servers` — name, calls observed, `UNUSED` flag in red (headline feature).
  - `esc` back to list, `q` quit.

### BarChart contract

Pure, deterministic, no side effects:
`bars(rows, width)` returns a string — label column padded, then `█` repeated
`round(value / max * width)`, min 1 block for nonzero values, empty for zero.
Testable without a terminal.

## Render path

`cli.ts` bare (default) action:
1. If `!process.stdout.isTTY` → run existing static aggregate, return.
2. Else `const projects = await loadProjects(); render(<App projects={projects} />)`.
3. Empty projects → friendly "no transcripts found" message, exit 1.

## Testing

- `BarChart.bars()` — unit test exact output strings (scaling, zero, min-block).
- `loadProjects` — temp fake home: two project dirs + `~/.claude.json`; assert
  grouping, cost sort, real-path/server resolution, and no-match fallback.
- `App` / `Dashboard` — `ink-testing-library`: assert rendered frames contain
  expected labels; simulate keypress to switch tabs / open a project / go back.
- All existing tests (pricing, transcript dedup, discover, mcp, attribute, report)
  stay green.

## Scope guard (YAGNI)

Out for v1: live refresh, mouse support, daily cost-over-time sparkline, search/filter,
export from TUI. Bars only. Revisit after the core browser ships.

## Non-goals / invariants

- No network, ever.
- Counting correctness unchanged — reuse the deduped parser and `buildReport`.
- Static + JSON output paths remain byte-for-byte as they are today.
