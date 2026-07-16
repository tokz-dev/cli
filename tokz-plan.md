# Tokz CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `tokz audit` — a TypeScript CLI that parses Claude Code transcripts + MCP configs and reports where tokens/dollars went, flagging unused MCP servers.

**Architecture:** Pure-offline pipeline: discover transcript files → parse JSONL usage per model → parse MCP configs → join into an audit report (cost, per-tool calls, unused servers, monthly projection) → render table or JSON. No network calls; cost comes from real `usage` fields in transcripts, priced by a hardcoded table.

**Tech Stack:** Node ≥22, TypeScript 5 (ESM), commander (CLI), zod (JSONL validation), tinyglobby (file discovery), cli-table3 + picocolors (output), tsup (build), vitest (tests).

## Global Constraints

- Repo lives in a NEW directory `tokz/` (its own git repo, not inside idea-miner).
- `"type": "module"` ESM throughout; imports use `.js` extensions (`from "./types.js"`).
- Node `>=22.0.0` engines field.
- Runtime deps EXACTLY: `commander`, `zod`, `tinyglobby`, `cli-table3`, `picocolors`. Dev deps: `typescript`, `tsup`, `vitest`, `@types/node`.
- NEVER call the network. NEVER use gpt-tokenizer/tiktoken (wrong for Claude by 15–20%). Token estimates for static files use chars/3.5 labeled "estimate".
- Pricing table is USD per million tokens, cached from Anthropic docs 2026-06-24: fable-5 10/50, opus-4-8|4-7|4-6 5/25, sonnet-5 3/15, sonnet-4-6 3/15, haiku-4-5 1/5. Cache read = 0.1× input price, cache write = 1.25× input price.
- Windows-safe paths: always `node:path` + `os.homedir()`, never hardcoded `/` or `~`.
- Commit after every task with the message given in that task.

---

### Task 1: Scaffold

**Files:**
- Create: `tokz/package.json`, `tokz/tsconfig.json`, `tokz/tsup.config.ts`, `tokz/.gitignore`

**Interfaces:**
- Produces: a repo where `npm test` runs vitest and `npm run build` runs tsup.

- [ ] **Step 1: Create files**

`package.json`:
```json
{
  "name": "tokz",
  "version": "0.1.0",
  "description": "Audit where your coding agent's context window and API dollars go.",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=22.0.0" },
  "bin": { "tokz": "./dist/cli.js" },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "dev": "tsx src/cli.ts"
  },
  "dependencies": {
    "cli-table3": "^0.6.5",
    "commander": "^13.0.0",
    "picocolors": "^1.1.0",
    "tinyglobby": "^0.2.10",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsup": "^8.3.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  target: "node22",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
```

`.gitignore`:
```
node_modules/
dist/
```

- [ ] **Step 2: Install and verify**

Run: `cd tokz && git init && npm install && npx vitest run`
Expected: vitest exits 0 or reports "No test files found" (acceptable at this stage — confirm install worked).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: scaffold tokz CLI (tsup, vitest, ESM)"
```

---

### Task 2: Types + pricing

**Files:**
- Create: `tokz/src/types.ts`, `tokz/src/pricing.ts`
- Test: `tokz/test/pricing.test.ts`

**Interfaces:**
- Produces: `UsageTotals`, `SessionStats`, `McpServer`, `ServerAudit`, `CostBreakdown`, `AuditReport` types; `resolvePrice(modelId): ModelPrice`; `costUsd(usage, modelId): CostBreakdown`; `emptyUsage(): UsageTotals`.

- [ ] **Step 1: Write the failing test**

`test/pricing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { costUsd, resolvePrice } from "../src/pricing.js";

describe("pricing", () => {
  it("resolves dated model ids by prefix", () => {
    expect(resolvePrice("claude-haiku-4-5-20251001").inputPerMTok).toBe(1);
  });

  it("prices usage: input full, cache read 0.1x, cache write 1.25x", () => {
    const cost = costUsd(
      { inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000, outputTokens: 1_000_000, turns: 1 },
      "claude-opus-4-8",
    );
    expect(cost.input).toBeCloseTo(5);
    expect(cost.cacheRead).toBeCloseTo(0.5);
    expect(cost.cacheWrite).toBeCloseTo(6.25);
    expect(cost.output).toBeCloseTo(25);
    expect(cost.total).toBeCloseTo(36.75);
  });

  it("falls back to opus pricing for unknown models", () => {
    expect(resolvePrice("claude-future-9").inputPerMTok).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pricing.test.ts`
Expected: FAIL — cannot resolve `../src/pricing.js`.

- [ ] **Step 3: Write implementation**

`src/types.ts`:
```ts
export interface UsageTotals {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  turns: number;
}

export interface SessionStats {
  file: string;
  firstTs?: string;
  lastTs?: string;
  usageByModel: Record<string, UsageTotals>;
  toolCalls: Record<string, number>;
}

export interface McpServer {
  name: string;
  source: string; // config file it came from
}

export interface ServerAudit extends McpServer {
  callsObserved: number;
  unused: boolean;
}

export interface CostBreakdown {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  total: number;
}

export interface AuditReport {
  sessionCount: number;
  spanDays: number;
  usageByModel: Record<string, UsageTotals>;
  costByModel: Record<string, CostBreakdown>;
  totalCostUsd: number;
  monthlyProjectionUsd: number;
  toolCalls: Record<string, number>;
  servers: ServerAudit[];
}
```

`src/pricing.ts`:
```ts
import type { CostBreakdown, UsageTotals } from "./types.js";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

// USD per million tokens. Cached from Anthropic docs 2026-06-24.
export const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;
const FALLBACK = PRICES["claude-opus-4-8"];

export function resolvePrice(modelId: string): ModelPrice {
  for (const [prefix, price] of Object.entries(PRICES)) {
    if (modelId.startsWith(prefix)) return price;
  }
  return FALLBACK;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 0 };
}

export function costUsd(usage: UsageTotals, modelId: string): CostBreakdown {
  const p = resolvePrice(modelId);
  const input = (usage.inputTokens / 1e6) * p.inputPerMTok;
  const cacheRead = (usage.cacheReadTokens / 1e6) * p.inputPerMTok * CACHE_READ_MULT;
  const cacheWrite = (usage.cacheCreationTokens / 1e6) * p.inputPerMTok * CACHE_WRITE_MULT;
  const output = (usage.outputTokens / 1e6) * p.outputPerMTok;
  return { input, cacheRead, cacheWrite, output, total: input + cacheRead + cacheWrite + output };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pricing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/pricing.ts test/pricing.test.ts && git commit -m "feat: types and Anthropic pricing table with cache multipliers"
```

---

### Task 3: Transcript parser

**Files:**
- Create: `tokz/src/transcript.ts`
- Test: `tokz/test/transcript.test.ts`

**Interfaces:**
- Consumes: `SessionStats`, `emptyUsage` from Task 2.
- Produces: `parseTranscript(file: string): Promise<SessionStats>` — accumulates `usageByModel` and `toolCalls` from assistant lines; skips malformed lines silently.

- [ ] **Step 1: Write the failing test**

`test/transcript.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from "../src/transcript.js";

const lines = [
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T10:00:00Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 30000, output_tokens: 200 },
      content: [
        { type: "text", text: "hi" },
        { type: "tool_use", name: "mcp__context7__query-docs" },
        { type: "tool_use", name: "Read" },
      ],
    },
  }),
  '{"type":"user","message":{"content":"hello"}}',
  "not json at all",
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-01T11:00:00Z",
    message: {
      model: "claude-opus-4-8",
      usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 },
      content: [{ type: "tool_use", name: "Read" }],
    },
  }),
].join("\n");

describe("parseTranscript", () => {
  it("accumulates usage per model and counts tool calls, skipping junk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tokz-"));
    const file = join(dir, "session.jsonl");
    writeFileSync(file, lines);

    const stats = await parseTranscript(file);
    const usage = stats.usageByModel["claude-opus-4-8"];
    expect(usage.inputTokens).toBe(110);
    expect(usage.cacheReadTokens).toBe(30000);
    expect(usage.cacheCreationTokens).toBe(50);
    expect(usage.outputTokens).toBe(220);
    expect(usage.turns).toBe(2);
    expect(stats.toolCalls["Read"]).toBe(2);
    expect(stats.toolCalls["mcp__context7__query-docs"]).toBe(1);
    expect(stats.firstTs).toBe("2026-07-01T10:00:00Z");
    expect(stats.lastTs).toBe("2026-07-01T11:00:00Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/transcript.test.ts`
Expected: FAIL — cannot resolve `../src/transcript.js`.

- [ ] **Step 3: Write implementation**

`src/transcript.ts`:
```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { emptyUsage } from "./pricing.js";
import type { SessionStats } from "./types.js";

const AssistantLine = z.object({
  type: z.literal("assistant"),
  timestamp: z.string().optional(),
  message: z.object({
    model: z.string().optional(),
    usage: z
      .object({
        input_tokens: z.number().catch(0).default(0),
        cache_creation_input_tokens: z.number().catch(0).default(0),
        cache_read_input_tokens: z.number().catch(0).default(0),
        output_tokens: z.number().catch(0).default(0),
      })
      .optional(),
    content: z
      .array(z.object({ type: z.string(), name: z.string().optional() }).passthrough())
      .optional(),
  }),
});

export async function parseTranscript(file: string): Promise<SessionStats> {
  const stats: SessionStats = { file, usageByModel: {}, toolCalls: {} };
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = AssistantLine.safeParse(raw);
    if (!parsed.success) continue;

    const { message, timestamp } = parsed.data;
    if (timestamp) {
      if (!stats.firstTs) stats.firstTs = timestamp;
      stats.lastTs = timestamp;
    }
    const model = message.model ?? "unknown";
    if (message.usage) {
      const u = (stats.usageByModel[model] ??= emptyUsage());
      u.inputTokens += message.usage.input_tokens;
      u.cacheCreationTokens += message.usage.cache_creation_input_tokens;
      u.cacheReadTokens += message.usage.cache_read_input_tokens;
      u.outputTokens += message.usage.output_tokens;
      u.turns += 1;
    }
    for (const block of message.content ?? []) {
      if (block.type === "tool_use" && block.name) {
        stats.toolCalls[block.name] = (stats.toolCalls[block.name] ?? 0) + 1;
      }
    }
  }
  return stats;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/transcript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transcript.ts test/transcript.test.ts && git commit -m "feat: JSONL transcript parser with per-model usage accumulation"
```

---

### Task 4: Discovery

**Files:**
- Create: `tokz/src/discover.ts`
- Test: `tokz/test/discover.test.ts`

**Interfaces:**
- Produces: `sanitizeProjectPath(p: string): string` (Claude Code's project-dir naming: every non-alphanumeric char becomes `-`); `transcriptDir(projectPath: string, home?: string): string`; `findTranscripts(projectPath?: string, home?: string): Promise<string[]>` (all `*.jsonl` under the project's transcript dir, or under ALL of `~/.claude/projects/` when no project given).

- [ ] **Step 1: Write the failing test**

`test/discover.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeProjectPath, transcriptDir, findTranscripts } from "../src/discover.js";

describe("discover", () => {
  it("sanitizes paths the way Claude Code names project dirs", () => {
    expect(sanitizeProjectPath("C:\\Users\\ASUS\\Documents\\proj")).toBe("C--Users-ASUS-Documents-proj");
    expect(sanitizeProjectPath("/home/me/my.app")).toBe("-home-me-my-app");
  });

  it("builds the transcript dir under home", () => {
    const dir = transcriptDir("/home/me/proj", "/home/me");
    expect(dir.replaceAll("\\", "/")).toBe("/home/me/.claude/projects/-home-me-proj");
  });

  it("finds jsonl transcripts in a fake home", async () => {
    const home = mkdtempSync(join(tmpdir(), "tokz-home-"));
    const projDir = join(home, ".claude", "projects", "-home-me-proj");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "a.jsonl"), "");
    writeFileSync(join(projDir, "ignore.txt"), "");

    const found = await findTranscripts("/home/me/proj", home);
    expect(found).toHaveLength(1);
    expect(found[0].endsWith("a.jsonl")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/discover.test.ts`
Expected: FAIL — cannot resolve `../src/discover.js`.

- [ ] **Step 3: Write implementation**

`src/discover.ts`:
```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";

export function sanitizeProjectPath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, "-");
}

export function transcriptDir(projectPath: string, home: string = homedir()): string {
  return join(home, ".claude", "projects", sanitizeProjectPath(projectPath));
}

export async function findTranscripts(projectPath?: string, home: string = homedir()): Promise<string[]> {
  const cwd = projectPath ? transcriptDir(projectPath, home) : join(home, ".claude", "projects");
  return glob(["**/*.jsonl"], { cwd, absolute: true }).catch(() => []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/discover.test.ts`
Expected: PASS.

Note: if the sanitize test fails against real-world dirs during smoke testing (Task 8), check the actual naming in `~/.claude/projects/` and adjust the regex — the invariant is "matches what Claude Code produces on this machine", the test encodes the currently observed scheme.

- [ ] **Step 5: Commit**

```bash
git add src/discover.ts test/discover.test.ts && git commit -m "feat: transcript discovery with Claude Code project-dir sanitization"
```

---

### Task 5: MCP config parser

**Files:**
- Create: `tokz/src/mcp.ts`
- Test: `tokz/test/mcp.test.ts`

**Interfaces:**
- Consumes: `McpServer` from Task 2.
- Produces: `findMcpServers(projectPath: string, home?: string): Promise<McpServer[]>` — merges `<project>/.mcp.json` (`mcpServers` key), `~/.claude.json` top-level `mcpServers`, and `~/.claude.json` `projects[<projectPath>].mcpServers`. Dedupe by name (first source wins). Missing/invalid files are skipped silently.

- [ ] **Step 1: Write the failing test**

`test/mcp.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMcpServers } from "../src/mcp.js";

describe("findMcpServers", () => {
  it("merges project .mcp.json and global ~/.claude.json, deduped by name", async () => {
    const proj = mkdtempSync(join(tmpdir(), "tokz-proj-"));
    const home = mkdtempSync(join(tmpdir(), "tokz-home-"));

    writeFileSync(join(proj, ".mcp.json"), JSON.stringify({ mcpServers: { context7: { command: "npx" } } }));
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { context7: { command: "dupe" }, craftspace: { url: "https://x" } },
        projects: { [proj]: { mcpServers: { local: { command: "node" } } } },
      }),
    );

    const servers = await findMcpServers(proj, home);
    const names = servers.map((s) => s.name).sort();
    expect(names).toEqual(["context7", "craftspace", "local"]);
    expect(servers.find((s) => s.name === "context7")!.source.endsWith(".mcp.json")).toBe(true);
  });

  it("returns empty list when no configs exist", async () => {
    const proj = mkdtempSync(join(tmpdir(), "tokz-empty-"));
    const home = mkdtempSync(join(tmpdir(), "tokz-emptyhome-"));
    expect(await findMcpServers(proj, home)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL — cannot resolve `../src/mcp.js`.

- [ ] **Step 3: Write implementation**

`src/mcp.ts`:
```ts
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "./types.js";

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

function serverNames(obj: unknown): string[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) return Object.keys(obj);
  return [];
}

export async function findMcpServers(projectPath: string, home: string = homedir()): Promise<McpServer[]> {
  const out = new Map<string, McpServer>();
  const add = (names: string[], source: string) => {
    for (const name of names) if (!out.has(name)) out.set(name, { name, source });
  };

  const projectFile = join(projectPath, ".mcp.json");
  const projectCfg = await readJson(projectFile);
  add(serverNames(projectCfg?.mcpServers), projectFile);

  const globalFile = join(home, ".claude.json");
  const globalCfg = await readJson(globalFile);
  add(serverNames(globalCfg?.mcpServers), globalFile);

  const projects = globalCfg?.projects;
  if (projects && typeof projects === "object") {
    const entry = (projects as Record<string, { mcpServers?: unknown }>)[projectPath];
    add(serverNames(entry?.mcpServers), `${globalFile} (project entry)`);
  }

  return [...out.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts test/mcp.test.ts && git commit -m "feat: MCP server config discovery (.mcp.json + ~/.claude.json)"
```

---

### Task 6: Attribution

**Files:**
- Create: `tokz/src/attribute.ts`
- Test: `tokz/test/attribute.test.ts`

**Interfaces:**
- Consumes: `SessionStats`, `McpServer`, `AuditReport` (Task 2); `costUsd`, `emptyUsage` (Task 2).
- Produces: `buildReport(sessions: SessionStats[], servers: McpServer[]): AuditReport`. MCP tool calls are recognized by the `mcp__<server>__` name prefix. `spanDays` = max(1, days between earliest firstTs and latest lastTs). `monthlyProjectionUsd` = totalCost / spanDays * 30.

- [ ] **Step 1: Write the failing test**

`test/attribute.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildReport } from "../src/attribute.js";
import type { SessionStats } from "../src/types.js";

const session: SessionStats = {
  file: "a.jsonl",
  firstTs: "2026-07-01T00:00:00Z",
  lastTs: "2026-07-11T00:00:00Z",
  usageByModel: {
    "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 0, turns: 5 },
  },
  toolCalls: { "mcp__context7__query-docs": 3, Read: 10 },
};

describe("buildReport", () => {
  it("flags unused servers, sums cost, projects monthly", () => {
    const report = buildReport([session], [
      { name: "context7", source: "x" },
      { name: "craftspace", source: "y" },
    ]);

    expect(report.sessionCount).toBe(1);
    expect(report.totalCostUsd).toBeCloseTo(5); // 1M input on opus-4-8
    expect(report.spanDays).toBe(10);
    expect(report.monthlyProjectionUsd).toBeCloseTo(15); // 5 / 10 * 30

    const context7 = report.servers.find((s) => s.name === "context7")!;
    const craftspace = report.servers.find((s) => s.name === "craftspace")!;
    expect(context7.callsObserved).toBe(3);
    expect(context7.unused).toBe(false);
    expect(craftspace.callsObserved).toBe(0);
    expect(craftspace.unused).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/attribute.test.ts`
Expected: FAIL — cannot resolve `../src/attribute.js`.

- [ ] **Step 3: Write implementation**

`src/attribute.ts`:
```ts
import { costUsd, emptyUsage } from "./pricing.js";
import type { AuditReport, CostBreakdown, McpServer, SessionStats, UsageTotals } from "./types.js";

const DAY_MS = 86_400_000;

export function buildReport(sessions: SessionStats[], servers: McpServer[]): AuditReport {
  const usageByModel: Record<string, UsageTotals> = {};
  const toolCalls: Record<string, number> = {};
  let earliest = Infinity;
  let latest = -Infinity;

  for (const s of sessions) {
    for (const [model, u] of Object.entries(s.usageByModel)) {
      const acc = (usageByModel[model] ??= emptyUsage());
      acc.inputTokens += u.inputTokens;
      acc.cacheReadTokens += u.cacheReadTokens;
      acc.cacheCreationTokens += u.cacheCreationTokens;
      acc.outputTokens += u.outputTokens;
      acc.turns += u.turns;
    }
    for (const [name, n] of Object.entries(s.toolCalls)) {
      toolCalls[name] = (toolCalls[name] ?? 0) + n;
    }
    if (s.firstTs) earliest = Math.min(earliest, Date.parse(s.firstTs));
    if (s.lastTs) latest = Math.max(latest, Date.parse(s.lastTs));
  }

  const costByModel: Record<string, CostBreakdown> = {};
  let totalCostUsd = 0;
  for (const [model, u] of Object.entries(usageByModel)) {
    costByModel[model] = costUsd(u, model);
    totalCostUsd += costByModel[model].total;
  }

  const spanDays =
    Number.isFinite(earliest) && Number.isFinite(latest)
      ? Math.max(1, Math.round((latest - earliest) / DAY_MS))
      : 1;

  const mcpCalls = (server: string) =>
    Object.entries(toolCalls)
      .filter(([name]) => name.startsWith(`mcp__${server}__`))
      .reduce((sum, [, n]) => sum + n, 0);

  const serverAudits = servers.map((srv) => {
    const callsObserved = mcpCalls(srv.name);
    return { ...srv, callsObserved, unused: callsObserved === 0 };
  });

  return {
    sessionCount: sessions.length,
    spanDays,
    usageByModel,
    costByModel,
    totalCostUsd,
    monthlyProjectionUsd: (totalCostUsd / spanDays) * 30,
    toolCalls,
    servers: serverAudits,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/attribute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/attribute.ts test/attribute.test.ts && git commit -m "feat: audit report builder with unused-server detection and monthly projection"
```

---

### Task 7: Report renderer

**Files:**
- Create: `tokz/src/report.ts`
- Test: `tokz/test/report.test.ts`

**Interfaces:**
- Consumes: `AuditReport` (Task 2).
- Produces: `renderReport(report: AuditReport): string` — headline + cost table + servers table + top-10 tools table. Colors via picocolors (auto-disabled when not TTY, picocolors handles that).

- [ ] **Step 1: Write the failing test**

`test/report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderReport } from "../src/report.js";
import type { AuditReport } from "../src/types.js";

const report: AuditReport = {
  sessionCount: 2,
  spanDays: 10,
  usageByModel: {
    "claude-opus-4-8": { inputTokens: 1_000_000, cacheReadTokens: 5_000_000, cacheCreationTokens: 100_000, outputTokens: 200_000, turns: 42 },
  },
  costByModel: {
    "claude-opus-4-8": { input: 5, cacheRead: 2.5, cacheWrite: 0.625, output: 5, total: 13.125 },
  },
  totalCostUsd: 13.125,
  monthlyProjectionUsd: 39.375,
  toolCalls: { Read: 30, "mcp__context7__query-docs": 2 },
  servers: [
    { name: "context7", source: "x", callsObserved: 2, unused: false },
    { name: "craftspace", source: "y", callsObserved: 0, unused: true },
  ],
};

describe("renderReport", () => {
  it("includes headline cost, unused marker, and tool counts", () => {
    const out = renderReport(report);
    expect(out).toContain("$13.13");
    expect(out).toContain("$39.38/month");
    expect(out).toContain("craftspace");
    expect(out).toContain("UNUSED");
    expect(out).toContain("Read");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/report.test.ts`
Expected: FAIL — cannot resolve `../src/report.js`.

- [ ] **Step 3: Write implementation**

`src/report.ts`:
```ts
import Table from "cli-table3";
import pc from "picocolors";
import type { AuditReport } from "./types.js";

const usd = (n: number) => `$${n.toFixed(2)}`;
const tok = (n: number) => n.toLocaleString("en-US");

export function renderReport(report: AuditReport): string {
  const parts: string[] = [];

  parts.push(
    pc.bold(
      `tokz audit — ${report.sessionCount} sessions over ${report.spanDays} days: ` +
        `${usd(report.totalCostUsd)} spent, projected ${usd(report.monthlyProjectionUsd)}/month`,
    ),
  );

  const costTable = new Table({ head: ["Model", "Input", "Cache read", "Cache write", "Output", "Cost"] });
  for (const [model, u] of Object.entries(report.usageByModel)) {
    const c = report.costByModel[model];
    costTable.push([model, tok(u.inputTokens), tok(u.cacheReadTokens), tok(u.cacheCreationTokens), tok(u.outputTokens), usd(c.total)]);
  }
  parts.push(costTable.toString());

  if (report.servers.length > 0) {
    const serverTable = new Table({ head: ["MCP server", "Calls observed", "Status", "Configured in"] });
    for (const s of report.servers) {
      serverTable.push([
        s.name,
        String(s.callsObserved),
        s.unused ? pc.red("UNUSED — schema loaded every turn for nothing") : pc.green("used"),
        s.source,
      ]);
    }
    parts.push(serverTable.toString());
  }

  const topTools = Object.entries(report.toolCalls)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  if (topTools.length > 0) {
    const toolTable = new Table({ head: ["Tool", "Calls"] });
    for (const [name, n] of topTools) toolTable.push([name, String(n)]);
    parts.push(toolTable.toString());
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/report.test.ts`
Expected: PASS. (picocolors emits no ANSI codes under vitest's non-TTY stdout, so plain `toContain` matches.)

- [ ] **Step 5: Commit**

```bash
git add src/report.ts test/report.test.ts && git commit -m "feat: terminal report renderer with cost, server, and tool tables"
```

---

### Task 8: CLI wiring + smoke test

**Files:**
- Create: `tokz/src/cli.ts`, `tokz/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `tokz audit [project]` with `--json` flag. `project` defaults to `process.cwd()`; passing `--all` scans every project under `~/.claude/projects/`.

- [ ] **Step 1: Write the CLI**

`src/cli.ts`:
```ts
import { Command } from "commander";
import { buildReport } from "./attribute.js";
import { findTranscripts } from "./discover.js";
import { findMcpServers } from "./mcp.js";
import { renderReport } from "./report.js";
import { parseTranscript } from "./transcript.js";

const program = new Command();

program
  .name("tokz")
  .description("Audit where your coding agent's context window and API dollars go.")
  .version("0.1.0");

program
  .command("audit")
  .argument("[project]", "project path (default: current directory)")
  .option("--all", "scan all projects under ~/.claude/projects")
  .option("--json", "output raw JSON report")
  .action(async (project: string | undefined, opts: { all?: boolean; json?: boolean }) => {
    const projectPath = project ?? process.cwd();
    const transcripts = await findTranscripts(opts.all ? undefined : projectPath);
    if (transcripts.length === 0) {
      console.error(`No Claude Code transcripts found for ${opts.all ? "any project" : projectPath}.`);
      process.exitCode = 1;
      return;
    }
    const sessions = await Promise.all(transcripts.map(parseTranscript));
    const servers = opts.all ? [] : await findMcpServers(projectPath);
    const report = buildReport(sessions, servers);
    console.log(opts.json ? JSON.stringify(report, null, 2) : renderReport(report));
  });

program.parseAsync();
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: all suites PASS.

- [ ] **Step 3: Smoke test against real data**

Run: `npx tsx src/cli.ts audit --all`
Expected: real report with nonzero cost (this machine has Claude Code transcripts). If sanitization mismatches real dir names, fix `sanitizeProjectPath` + its test now.

Run: `npm run build && node dist/cli.js audit --all --json | head -40`
Expected: valid JSON.

- [ ] **Step 4: Write README**

`README.md`:
```markdown
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
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tokz audit CLI command and README"
```

---

## Self-review notes

- Spec coverage: validation plan's week-1–2 scope = per-server/per-tool attribution ✅ (Tasks 5–6), $/month figure ✅ (Task 6 projection, Task 7 headline), unused-tool detection ✅ (Task 6), config parsing ✅ (Task 5), opencode/Copilot support ❌ deliberately deferred past v0 (validation plan says Claude Code first).
- Known limitation to document at ship time: cost from `usage` fields is exact for API-billed users; seat-plan (Max) users see token volume but the dollar figure is what it *would* cost on API — label it "API-equivalent cost" in a follow-up if testers get confused.
- Static-file token estimation (CLAUDE.md, skills) intentionally excluded from v0 — transcripts' `cache_read` volume already surfaces the overhead cost signal without a tokenizer.
