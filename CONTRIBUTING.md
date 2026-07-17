# Contributing to tokz

Thanks for helping out. tokz is a small, dependency-light TypeScript CLI — easy
to hack on.

## Setup

```bash
npm install
npm run dev        # run the CLI from source (tsx src/cli.ts)
npm test           # vitest
npx tsc --noEmit   # typecheck
npm run build      # bundle to dist/ (tsup)
```

Requires Node ≥ 20.9. CI runs typecheck + tests + build on Node 20 and 22; run
those three locally before opening a PR.

## Project layout

```
src/
  cli.ts            commander entry — commands (audit, blocks, statusline) + TUI
  transcript.ts     Claude Code transcript parser (the tricky one — read its header)
  attribute.ts      SessionStats[] -> AuditReport (cost, servers, daily, sessions)
  pricing.ts        static price table + resolvePrice
  livePricing.ts    LiteLLM catalog fetch + disk cache
  blocks.ts         5-hour billing windows + burn rate
  statusline.ts     Claude Code statusLine hook renderer
  sqlite.ts         minimal pure-JS read-only SQLite reader
  dates.ts          timezone-aware day grouping, week/month rollup
  agents/           one file per agent (see below)
  ui/               Ink components
test/               vitest; binary fixtures under test/fixtures/
```

Everything funnels through two types: **`SessionStats`** (one agent session's
usage) and **`AuditReport`** (the aggregated result). An adapter's only job is
to produce `SessionStats`; `attribute.ts` does the rest.

## Adding an agent

This is the most common contribution. An agent is an `AgentAdapter`
(`src/agents/types.ts`): an `id`, a `name`, a `detect()`, and a
`loadProjects()`.

1. **Find the data.** Locate where the agent writes session logs (usually under
   `~`). Note the format and the token fields.
2. **Write `src/agents/<id>.ts`.** Parse each session into a `SessionStats`,
   then hand the list to `groupSessionsByCwd(id, sessions)` (in `projects.ts`)
   to get `ProjectAudit[]`. Reuse the helpers:
   - JSONL / JSON: `readJsonl`, `readJson`, `pickNum`, `str`, `deepFind`,
     `toIso`, `sessionFromRecords` in `agents/usage.ts`.
   - SQLite: `readTable(file, table)` in `sqlite.ts` — no native dependency.
3. **Register it** in the `ADAPTERS` array in `src/agents/index.ts`.
4. **Can't parse it?** If the local data has no usable token counts, use
   `detectOnly(id, name, reason, ...pathCandidates)` so the agent still shows up
   in the picker with an honest reason. If counts must be estimated (no exact
   data on disk), set `estimated: true` + an `estimateNote` and label it clearly.
5. **Validate against real data.** Field names from docs are not enough — a
   wrong key silently produces wrong dollars. Run the adapter against a real
   session file, or generate a real fixture (for SQLite, `python -c` with the
   `sqlite3` module writes a genuine DB), and add a test.

Adapters must be defensive: skip malformed input, never throw. A bad file should
lower a number, never crash the run.

## Tests

Use vitest. **Write tests that would actually catch a regression** — parsing
correctness, pricing math, format edge cases, the token-dedup logic. Skip tests
that just restate trivial pure code or re-assert framework behavior. Binary
fixtures (SQLite DBs) live in `test/fixtures/`.

## Pull requests

- Keep commits focused; a short imperative subject (`feat:`, `fix:`, `perf:`,
  `chore:`) is plenty.
- Make sure `npx tsc --noEmit`, `npm test`, and `npm run build` all pass.
- Match the surrounding style — comments explain *why*, not *what*.
