# tokz

Audit where your coding agent's context window — and API dollars — actually go.

```bash
npx tokz                  # interactive TUI: browse projects, drill into charts
npx tokz audit            # static report for the current project
npx tokz audit --all      # static report across every project on this machine
npx tokz audit --json     # machine-readable report
```

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
  3. **Tools** — top tools by call count with share; MCP tools highlighted.
  4. **Servers** — every configured MCP server, calls observed, and whether
     it's dead weight in your context window.
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
