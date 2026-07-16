# tokz

Audit where your coding agent's context window — and API dollars — actually go.

```bash
npx tokz                  # interactive TUI: browse projects, drill into charts
npx tokz audit            # static report for the current project
npx tokz audit --all      # static report across every project on this machine
npx tokz audit --json     # machine-readable report
```

Bare `tokz` launches an interactive terminal UI (Ink): a cost-ranked project
list you arrow through, each opening a tabbed dashboard (Overview / Models /
Tools / Servers) with Unicode bar charts. Piped or non-interactive, it falls
back to the static aggregate report automatically.

Reads Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) and MCP configs
(`.mcp.json`, `~/.claude.json`). Reports real billed token usage per model
(input / cache read / cache write / output), dollar cost at current Anthropic
pricing, a monthly projection, per-tool call counts, and — the headline —
**MCP servers you pay to load on every turn but never call**.

100% offline. No API key, no telemetry, nothing leaves your machine.
