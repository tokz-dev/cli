import { createRequire } from "node:module";
import { Command } from "commander";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
import { buildReport } from "./attribute.js";
import { buildBlocks, type UsageEvent } from "./blocks.js";
import { renderBlocksReport } from "./blocksReport.js";
import { groupDaily, parseDateArg, setTimezone, type Grouping } from "./dates.js";
import { findTranscripts } from "./discover.js";
import { initPricing } from "./livePricing.js";
import { findMcpServers } from "./mcp.js";
import { renderActivity, renderReport } from "./report.js";
import { parseTranscript, type CountedUsage } from "./transcript.js";

const program = new Command();

program
  .name("tokz")
  .description("Audit where your coding agent's context window and API dollars go.")
  .option("--offline", "don't fetch live pricing; use cached/built-in rates")
  .option("--timezone <zone>", 'group days in this timezone: "utc" (default), "local", or an IANA name')
  .version(version);

function applyGlobals(): { offline?: boolean } {
  const opts = program.opts<{ offline?: boolean; timezone?: string }>();
  setTimezone(opts.timezone);
  return { offline: opts.offline };
}

async function parseAll(projectPath?: string, events?: UsageEvent[]) {
  const transcripts = await findTranscripts(projectPath);
  const seenMessageIds = new Map<string, CountedUsage>();
  const seenToolIds = new Set<string>();
  const sessions = await Promise.all(
    transcripts.map((f) => parseTranscript(f, seenMessageIds, seenToolIds, events)),
  );
  return { transcripts, sessions };
}

interface AuditOpts {
  all?: boolean;
  json?: boolean;
  days?: string;
  since?: string;
  until?: string;
  weekly?: boolean;
  monthly?: boolean;
}

program
  .command("audit")
  .argument("[project]", "project path (default: current directory)")
  .option("--all", "scan all projects under ~/.claude/projects")
  .option("--json", "output raw JSON report")
  .option("--days <n>", "only include the last N days of activity")
  .option("--since <date>", "start date, YYYY-MM-DD or YYYYMMDD (inclusive)")
  .option("--until <date>", "end date, YYYY-MM-DD or YYYYMMDD (inclusive)")
  .option("--weekly", "append activity grouped by week")
  .option("--monthly", "append activity grouped by month")
  .action(async (project: string | undefined, opts: AuditOpts) => {
    const globals = applyGlobals();
    const projectPath = project ?? process.cwd();
    const [{ transcripts, sessions }] = await Promise.all([
      parseAll(opts.all ? undefined : projectPath),
      initPricing(globals),
    ]);
    if (transcripts.length === 0) {
      console.error(`No Claude Code transcripts found for ${opts.all ? "any project" : projectPath}.`);
      process.exitCode = 1;
      return;
    }
    const servers = opts.all ? [] : await findMcpServers(projectPath);

    const days = opts.days ? Number.parseInt(opts.days, 10) : undefined;
    const isoDay = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const since = parseDateArg(opts.since);
    const until = parseDateArg(opts.until);
    let range: { from: string; to: string } | undefined;
    if (since || until) range = { from: since ?? "0000-01-01", to: until ?? "9999-12-31" };
    else if (days && days > 0) range = { from: isoDay(days - 1), to: isoDay(0) };

    const report = buildReport(sessions, servers, range);
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const parts = [renderReport(report)];
    const grouping: Grouping | undefined = opts.monthly ? "month" : opts.weekly ? "week" : undefined;
    if (grouping) parts.push(renderActivity(groupDaily(report.daily, grouping), grouping));
    console.log(parts.join("\n\n"));
  });

program
  .command("blocks")
  .description("Claude usage grouped into rolling 5-hour billing windows")
  .option("--json", "output raw JSON")
  .option("--active", "show only the currently active block")
  .option("--recent", "only blocks from the last 3 days")
  .option("--token-limit <n>", 'warn near this many tokens per block ("max" = highest past block)')
  .option("--session-length <hours>", "block length in hours (default 5)")
  .action(async (opts: { json?: boolean; active?: boolean; recent?: boolean; tokenLimit?: string; sessionLength?: string }) => {
    const globals = applyGlobals();
    const events: UsageEvent[] = [];
    await Promise.all([parseAll(undefined, events), initPricing(globals)]);
    const hours = opts.sessionLength ? Number.parseFloat(opts.sessionLength) : 5;
    let blocks = buildBlocks(events, { sessionLengthMs: hours * 3_600_000 });
    if (opts.recent) blocks = blocks.filter((b) => b.lastTs >= Date.now() - 3 * 86_400_000);
    if (opts.active) blocks = blocks.filter((b) => b.active);
    const tokenLimit =
      opts.tokenLimit === "max" ? ("max" as const) : opts.tokenLimit ? Number.parseInt(opts.tokenLimit, 10) : undefined;
    if (opts.json) {
      console.log(JSON.stringify(blocks, null, 2));
      return;
    }
    console.log(renderBlocksReport(blocks, { tokenLimit }));
  });

program
  .command("statusline")
  .description("compact usage line for Claude Code's statusLine hook (reads hook JSON on stdin)")
  .argument("[action]", '"enable" writes the hook into ~/.claude/settings.json, "disable" removes it')
  .option("--cost-source <mode>", "session cost source: auto | cc | ccusage | both", "auto")
  .action(async (action: string | undefined, opts: { costSource?: string }) => {
    const globals = applyGlobals();
    const sl = await import("./statusline.js");
    if (action === "enable" || action === "disable") {
      try {
        console.log(action === "enable" ? await sl.enableStatusline() : await sl.disableStatusline());
      } catch (err) {
        console.error(`Could not update settings: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
      return;
    }
    if (action !== undefined) {
      console.error(`Unknown action "${action}" — use "enable" or "disable".`);
      process.exitCode = 1;
      return;
    }
    // Never fetch from the statusline path — it must render instantly.
    await initPricing({ ...globals, offline: true });
    let input: unknown = {};
    try {
      input = JSON.parse(await sl.readStdin());
    } catch {
      // no/invalid stdin: still render what we can
    }
    const valid = ["auto", "cc", "ccusage", "both"] as const;
    const costSource = valid.includes((opts.costSource ?? "auto") as (typeof valid)[number])
      ? ((opts.costSource ?? "auto") as (typeof valid)[number])
      : "auto";
    console.log(await sl.statusline(input as Record<string, never>, Date.now(), undefined, { costSource }));
  });

program.action(async () => {
  const globals = applyGlobals();
  await initPricing(globals);
  if (!process.stdout.isTTY) {
    const { transcripts, sessions } = await parseAll(undefined);
    if (transcripts.length === 0) {
      console.error("No Claude Code transcripts found.");
      process.exitCode = 1;
      return;
    }
    console.log(renderReport(buildReport(sessions, [])));
    return;
  }
  const [{ render }, React, { Root }, { Fullscreen }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./ui/Root.js"),
    import("./ui/Fullscreen.js"),
  ]);
  render(React.createElement(Fullscreen, null, React.createElement(Root)));
});

program.parseAsync();
