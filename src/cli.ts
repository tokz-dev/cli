import { createRequire } from "node:module";
import { Command } from "commander";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
import { buildReport } from "./attribute.js";
import { findTranscripts } from "./discover.js";
import { findMcpServers } from "./mcp.js";
import { renderReport } from "./report.js";
import { parseTranscript, type CountedUsage } from "./transcript.js";

const program = new Command();

program
  .name("tokz")
  .description("Audit where your coding agent's context window and API dollars go.")
  .version(version);

program
  .command("audit")
  .argument("[project]", "project path (default: current directory)")
  .option("--all", "scan all projects under ~/.claude/projects")
  .option("--json", "output raw JSON report")
  .option("--days <n>", "only include the last N days of activity")
  .action(async (project: string | undefined, opts: { all?: boolean; json?: boolean; days?: string }) => {
    const projectPath = project ?? process.cwd();
    const transcripts = await findTranscripts(opts.all ? undefined : projectPath);
    if (transcripts.length === 0) {
      console.error(`No Claude Code transcripts found for ${opts.all ? "any project" : projectPath}.`);
      process.exitCode = 1;
      return;
    }
    const seenMessageIds = new Map<string, CountedUsage>();
    const seenToolIds = new Set<string>();
    const sessions = await Promise.all(
      transcripts.map((f) => parseTranscript(f, seenMessageIds, seenToolIds)),
    );
    const servers = opts.all ? [] : await findMcpServers(projectPath);
    const days = opts.days ? Number.parseInt(opts.days, 10) : undefined;
    const isoDay = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const range = days && days > 0 ? { from: isoDay(days - 1), to: isoDay(0) } : undefined;
    const report = buildReport(sessions, servers, range);
    console.log(opts.json ? JSON.stringify(report, null, 2) : renderReport(report));
  });

program.action(async () => {
  if (!process.stdout.isTTY) {
    const transcripts = await findTranscripts(undefined);
    if (transcripts.length === 0) {
      console.error("No Claude Code transcripts found.");
      process.exitCode = 1;
      return;
    }
    const seenMessageIds = new Map<string, CountedUsage>();
    const seenToolIds = new Set<string>();
    const sessions = await Promise.all(
      transcripts.map((f) => parseTranscript(f, seenMessageIds, seenToolIds)),
    );
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
