# tokz

Audit where your coding agent's context window — and API dollars — actually go.

```bash
npx tokz audit            # audit the current project's Claude Code sessions
npx tokz audit --all      # audit every project on this machine
npx tokz audit --json     # machine-readable report
```

Reads Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) and MCP configs
(`.mcp.json`, `~/.claude.json`). Reports real billed token usage per model
(input / cache read / cache write / output), dollar cost at current Anthropic
pricing, a monthly projection, per-tool call counts, and — the headline —
**MCP servers you pay to load on every turn but never call**.

100% offline. No API key, no telemetry, nothing leaves your machine.
