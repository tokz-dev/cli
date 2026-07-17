# tokz

Audit where your coding agents' context windows — and API dollars — actually go.

Supports multiple agentic coders: **Claude Code** (`~/.claude/projects`),
**OpenAI Codex CLI** (`~/.codex/sessions` rollout files, cumulative
token-count deltas), **OpenCode** (`~/.local/share/opencode/storage`), and
**Antigravity CLI** (`~/.gemini/antigravity-cli`). Antigravity stores no
token counts on disk, so its numbers are *estimates*: per-model turn counts
are read from the conversation databases' generation-metadata records,
projects and dates from `history.jsonl`, and tokens are derived from
conversation content size (~4 chars/token) — the UI labels it "estimated"
everywhere. Cursor CLI is detected and listed with the reason it can't be
parsed yet. The TUI opens with an agent picker — choose which agent's
analytics to explore; everything downstream (projects, dashboards,
timeframes) is scoped to it.

```bash
npx @tokz/cli             # interactive TUI: browse projects, drill into charts
npx @tokz/cli audit       # static report for the current project
npx @tokz/cli audit --all # static report across every project on this machine
npx @tokz/cli blocks      # Claude usage by rolling 5-hour billing window

npm i -g @tokz/cli        # installs the `tokz` command
tokz                      # then just: tokz
```

## Blocks (5-hour billing windows)

`tokz blocks` groups Claude usage into the rolling 5-hour windows Claude's
usage limits operate on: one row per block with models, total tokens, and
cost, plus burn rate (tok/min and $/hr), projected tokens/cost by block end,
and time remaining for the active block. `--active` shows only the current
block, `--recent` the last 3 days, `--token-limit N` (or `max` — your
biggest past block) adds ⚠️/🚨 warnings, `--session-length H` changes the
window, `--json` for raw output.

## Statusline for Claude Code

`tokz statusline` renders one compact line for Claude Code's status bar —
model, session cost, today's total, active block cost with time left, burn
rate, and context usage with percentage. Wire it up in
`~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "npx @tokz/cli statusline" }
}
```

It reads only transcripts touched in the last few hours and never fetches
pricing from the network on this path, so it stays fast.

## Dates, ranges, and timezones

- `tokz audit --since 2026-07-01 --until 2026-07-15` — any inclusive date
  range (also accepts `YYYYMMDD`); `--days N` still works.
- `tokz audit --weekly` / `--monthly` — appends an activity table rolled up
  by ISO week (keyed by its Monday) or calendar month. In the TUI the
  Activity tab cycles day · week · month with `g`.
- `tokz --timezone local audit …` — group days in your system timezone, or
  any IANA zone (`--timezone Asia/Amman`); default is UTC.

## Interactive TUI

Bare `tokz` launches a full-screen terminal UI (Ink) with a live parse
progress bar, then a landing screen of stat cards — total cost, monthly
projection, sessions, turns, cache hit rate — plus a 30-day activity
sparkline.

From there:

- **Project list** — every project by short name (real paths recovered from
  the transcripts themselves), ranked by cost, with session count, last
  activity, and share bars, plus a pinned **All projects** row. Press `/` to
  filter by name, `s` to cycle sorting (cost · recent · name), `a` to jump to
  the aggregate view.
- **Dashboard** (per project or aggregated) — six tabs, switched with `1–6`
  or `←`/`→`:
  1. **Overview** — stat cards, 30-day cost sparkline with peak day, cost by
     model, top tools, unused-server warning.
  2. **Models** — per-model token table (input / cache read / cache write /
     output / turns), cost and share, plus the total cost split.
  3. **Tools** — top tools ranked by estimated cost (each turn's bill split
     across the tools that turn called) with call counts and share; MCP tools
     highlighted.
  4. **Servers** — every MCP server with calls observed and estimated cost.
     Covers both configured servers (`.mcp.json`, `~/.claude.json`) and ones
     only visible in transcripts — plugin MCP servers and externally managed
     configs — plus whether each is dead weight in your context window.
  5. **Sessions** — costliest sessions with date, wall-clock length, turns,
     tool calls, and dominant model.
  6. **Activity** — daily cost bars with turn counts, average per active day.
- **Timeframe** — press `t` anywhere to cycle All time · Today · Yesterday ·
  Last 7 days · Last 30 days; every list, chart, and total rescopes to that
  window (`--days N` does the same for the static report).
- `?` shows a help overlay, `esc` goes back, `q` quits.

The layout is responsive: on narrow terminals the list drops columns (share
bar, then last-active, then sessions), tables keep only their key columns,
tab labels collapse to numbers, and the banner shrinks — nothing wraps or
breaks down to ~35 columns.

Piped or non-interactive, `tokz` falls back to the static aggregate report
automatically.

## What it measures

Reads Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) and MCP configs
(`.mcp.json`, `~/.claude.json`). Reports real billed token usage per model
(input / cache read / cache write / output), dollar cost at current Anthropic
pricing, a monthly projection, cache hit rate and estimated cache savings,
per-tool call counts, per-day activity, per-session cost, and — the headline —
**MCP servers you pay to load on every turn but never call**.

Costs are API-equivalent: what these tokens would bill at Anthropic
pay-as-you-go rates. On a Pro/Max subscription treat it as value received,
not a bill.

100% offline. No API key, no telemetry, nothing leaves your machine.
