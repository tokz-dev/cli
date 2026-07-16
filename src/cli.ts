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
    const seenMessageIds = new Set<string>();
    const seenToolIds = new Set<string>();
    const sessions = await Promise.all(
      transcripts.map((f) => parseTranscript(f, seenMessageIds, seenToolIds)),
    );
    const servers = opts.all ? [] : await findMcpServers(projectPath);
    const report = buildReport(sessions, servers);
    console.log(opts.json ? JSON.stringify(report, null, 2) : renderReport(report));
  });

program.parseAsync();
