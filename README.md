# tokz

[![CI](https://github.com/tokz-dev/cli/actions/workflows/ci.yml/badge.svg)](https://github.com/tokz-dev/cli/actions/workflows/ci.yml)

**See where your coding agents' tokens — and dollars — actually go.**

tokz reads the session logs your coding agents already write to disk and turns
them into a clear picture of cost: per model, per project, per tool, per day,
and per MCP server — including the ones you pay to load on every turn but never
call. One command, no API key, nothing leaves your machine except an optional
pricing refresh.

```bash
npx @tokz/cli             # interactive TUI — pick an agent, browse projects, drill into charts
npx @tokz/cli audit       # static report for the current project
npx @tokz/cli audit --all # static report across every project on this machine
npx @tokz/cli blocks      # Claude usage by rolling 5-hour billing window

npm i -g @tokz/cli        # install the `tokz` command, then just: tokz
```

The TUI opens on an agent picker; everything downstream — projects, dashboards,
timeframes — is scoped to the agent you choose.

## Supported agents

tokz auto-detects each agent from its local data directory. No configuration.

| Agent | Reads from | Status |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | ✅ parsed |
| OpenAI Codex | `~/.codex/sessions` | ✅ parsed |
| OpenCode | `~/.local/share/opencode` | ✅ parsed |
| Gemini CLI | `~/.gemini/tmp` | ✅ parsed |
| Qwen Code | `~/.qwen` | ✅ parsed |
| Droid (Factory) | `~/.factory/sessions` | ✅ parsed |
| Codebuff | `~/.config/manicode*` | ✅ parsed |
| OpenClaw | `~/.openclaw` | ✅ parsed |
| Kimi CLI | `~/.kimi` | ✅ parsed |
| pi-agent | `~/.pi/agent` | ✅ parsed |
| Kilo | `~/.local/share/kilo/kilo.db` | ✅ parsed (SQLite) |
| Goose | `~/.local/share/goose` | ✅ parsed (SQLite) |
| Hermes | `~/.hermes/state.db` | ✅ parsed (SQLite) |
| GitHub Copilot CLI | `~/.copilot/otel` | ✅ parsed (OpenTelemetry) |
| Amp | `~/.local/share/amp` | ✅ parsed |
| Antigravity | `~/.gemini/antigravity-cli` | ≈ estimated¹ |
| Cursor | `~/.cursor` | 🔍 detected, not parsed² |

¹ Antigravity stores no token counts on disk. tokz reads real per-model turn
counts from its conversation databases and estimates tokens from content size
(~4 chars/token); the UI labels every Antigravity number **estimated**.

² Cursor keeps no token counts locally — its usage lives server-side behind
auth — so it's surfaced with that reason rather than parsed.

The SQLite-backed agents are read with a small built-in pure-JS SQLite reader,
so there's no native dependency and `npx` just works. When more than one agent
has data, the picker adds an **All agents** row that merges every agent's
projects into one cross-agent total.

## Config file (optional)

Drop defaults in `~/.tokz/config.json` so you don't retype flags; any CLI flag
still overrides it:

```json
{ "timezone": "local", "offline": false, "costSource": "auto", "days": 30 }
```

## Interactive TUI

Bare `tokz` launches a full-screen Ink UI: a live parse progress bar, then a
landing screen of stat cards — total cost, monthly projection, sessions, turns,
cache hit rate — with a 30-day activity sparkline.

- **Project list** — every project by short name (real paths recovered from the
  transcripts), ranked by cost, with session count, last activity, and share
  bars, plus a pinned **All projects** row. `/` filters, `s` cycles the sort
  (cost · recent · name), `a` jumps to the aggregate view.
- **Dashboard** (per project or aggregated) — six tabs via `1–6` or `←`/`→`:
  1. **Overview** — stat cards, 30-day cost sparkline with peak day, cost by
     model, top tools, unused-server warning.
  2. **Models** — per-model token table (input / cache read / cache write /
     output / turns), cost, and share.
  3. **Tools** — top tools ranked by estimated cost (each turn's bill split
     across the tools it called), with call counts; MCP tools highlighted.
  4. **Servers** — every MCP server with calls observed and estimated cost,
     from configs (`.mcp.json`, `~/.claude.json`) and from transcripts alone
     (plugin and externally-managed servers) — plus whether each is dead weight.
  5. **Sessions** — costliest sessions with date, wall-clock length, turns, tool
     calls, and dominant model.
  6. **Activity** — daily cost bars with turn counts; `g` groups by day · week ·
     month.
- **Timeframe** — `t` cycles All time · Today · Yesterday · Last 7 days · Last
  30 days; every list, chart, and total rescopes.
- `?` help overlay, `esc` back, `q` quit.

The layout is responsive down to ~35 columns — tables drop non-essential
columns, tab labels collapse to numbers, the banner shrinks — and long lists
scroll. Piped or non-interactive, `tokz` prints the static aggregate report.

## Blocks — Claude's 5-hour windows

`tokz blocks` groups Claude usage into the rolling 5-hour windows its usage
limits operate on: one row per block with models, total tokens, and cost, plus
burn rate (tok/min and $/hr), projected tokens and cost by block end, and time
remaining on the active block.

```bash
tokz blocks --active            # only the current block
tokz blocks --recent            # last 3 days
tokz blocks --token-limit max   # ⚠️/🚨 warnings vs your biggest past block
tokz blocks --session-length 5  # window length in hours (default 5)
tokz blocks --json              # raw output
```

## Statusline for Claude Code

`tokz statusline` renders one compact line for Claude Code's status bar:

```text
🤖 Fable 5 (high) | 💰 $0.23 session / $1.23 today / $0.45 block (2h 45m left) | 🔥 $0.12/hr | 🧠 25,000 (12%)
```

Model with reasoning effort, session cost, today's total, active-block cost with
time left, burn rate (colored by tokens/min), and context usage (colored by how
full the window is). Session cost, context, and effort come from Claude Code's
hook payload; today's total and the block come from your local transcripts.

```bash
tokz statusline enable    # add the hook to ~/.claude/settings.json
tokz statusline disable   # remove it (only if it's tokz's)
```

`enable` preserves everything else in your settings and refuses to touch a file
it can't parse. `--cost-source auto|cc|calc|both` picks the session-cost source:
`cc` uses Claude Code's own figure, `calc` recomputes from tokens, `both` shows
`($0.25 cc / $0.23 calc)`. The statusline reads only recently-touched
transcripts and never fetches pricing, so it stays instant.

## Dates, ranges, timezones

```bash
tokz audit --since 2026-07-01 --until 2026-07-15   # any inclusive range (also YYYYMMDD)
tokz audit --days 7                                # last N days
tokz audit --weekly      # or --monthly — appends an activity table by ISO week / month
tokz --timezone local audit …                      # or any IANA zone; default UTC
```

## What it measures

Real billed token usage per model (input / cache read / cache write / output),
dollar cost, monthly projection, cache hit rate and estimated cache savings,
per-tool call counts and cost, per-day activity, per-session cost, and — the
headline — **MCP servers you pay to load on every turn but never call**.

Costs are API-equivalent: what these tokens would bill at pay-as-you-go rates.
On a Pro/Max subscription, read it as value received, not a bill. Pricing comes
from a live model catalog, cached on disk for a day; run with `--offline` to
skip the fetch and use built-in rates.

## Privacy

Your session logs never leave your machine. The only network call tokz ever
makes is fetching public model pricing (cacheable, and fully skippable with
`--offline`). No API key, no telemetry.
