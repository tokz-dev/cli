import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { z } from "zod";
import { buildReport } from "../attribute.js";
import { emptyUsage } from "../pricing.js";
import { baseName, type LoadProgress, type ProjectAudit } from "../projects.js";
import type { SessionStats } from "../types.js";
import type { AgentAdapter } from "./types.js";

const Message = z.object({
  sessionID: z.string(),
  role: z.string(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  time: z.object({ created: z.number().optional(), completed: z.number().optional() }).optional(),
  tokens: z
    .object({
      input: z.number().catch(0).default(0),
      output: z.number().catch(0).default(0),
      reasoning: z.number().catch(0).default(0),
      cache: z
        .object({ read: z.number().catch(0).default(0), write: z.number().catch(0).default(0) })
        .optional(),
    })
    .optional(),
});

const Session = z.object({
  id: z.string(),
  directory: z.string().optional(),
  projectID: z.string().optional(),
  time: z.object({ created: z.number().optional() }).optional(),
});

const Project = z.object({ id: z.string(), worktree: z.string().optional() });

function opencodeRoot(home?: string): string {
  if (home) return join(home, ".local", "share", "opencode");
  return process.env.OPENCODE_DATA_DIR ?? join(homedir(), ".local", "share", "opencode");
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

export async function loadOpencodeProjects(
  home?: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ProjectAudit[]> {
  const root = opencodeRoot(home);
  const storage = join(root, "storage");
  const messageFiles = await glob(["message/*/*.json"], { cwd: storage, absolute: true }).catch(
    () => [],
  );
  if (messageFiles.length === 0) return [];

  // session id -> project directory
  const sessionDir = new Map<string, string>();
  const projectWorktree = new Map<string, string>();
  for (const f of await glob(["project/*.json"], { cwd: storage, absolute: true }).catch(() => [])) {
    const p = Project.safeParse(await readJson(f));
    if (p.success && p.data.worktree) projectWorktree.set(p.data.id, p.data.worktree);
  }
  const sessionFiles = await glob(["session/**/*.json"], { cwd: storage, absolute: true }).catch(
    () => [],
  );
  for (const f of sessionFiles) {
    const s = Session.safeParse(await readJson(f));
    if (!s.success) continue;
    const dir = s.data.directory ?? (s.data.projectID ? projectWorktree.get(s.data.projectID) : undefined);
    if (dir) sessionDir.set(s.data.id, dir);
  }

  // Accumulate one SessionStats per opencode session from its assistant messages.
  const bySession = new Map<string, SessionStats>();
  let parsed = 0;
  for (const f of messageFiles) {
    onProgress?.({ parsed, total: messageFiles.length, currentProject: "OpenCode messages" });
    const m = Message.safeParse(await readJson(f));
    parsed += 1;
    onProgress?.({ parsed, total: messageFiles.length, currentProject: "OpenCode messages" });
    if (!m.success || m.data.role !== "assistant" || !m.data.tokens) continue;

    const { sessionID, modelID, tokens, time } = m.data;
    const stats =
      bySession.get(sessionID) ??
      ({
        file: sessionID,
        cwd: sessionDir.get(sessionID),
        usageByModel: {},
        toolCalls: {},
        toolCostUsd: {},
        dailyUsage: {},
      } satisfies SessionStats);
    bySession.set(sessionID, stats);

    const model = modelID ?? "unknown";
    const ts = time?.created ? new Date(time.created).toISOString() : undefined;
    if (ts) {
      if (!stats.firstTs || ts < stats.firstTs) stats.firstTs = ts;
      if (!stats.lastTs || ts > stats.lastTs) stats.lastTs = ts;
    }
    const accs = [(stats.usageByModel[model] ??= emptyUsage())];
    if (ts) {
      const day = (stats.dailyUsage[ts.slice(0, 10)] ??= {});
      accs.push((day[model] ??= emptyUsage()));
    }
    for (const u of accs) {
      u.inputTokens += tokens.input;
      u.cacheReadTokens += tokens.cache?.read ?? 0;
      u.cacheCreationTokens += tokens.cache?.write ?? 0;
      u.outputTokens += tokens.output + tokens.reasoning;
      u.turns += 1;
    }
  }

  const byDir = new Map<string, SessionStats[]>();
  for (const s of bySession.values()) {
    if (Object.keys(s.usageByModel).length === 0) continue;
    const key = s.cwd ?? "(unknown project)";
    const list = byDir.get(key) ?? [];
    list.push(s);
    byDir.set(key, list);
  }

  const out: ProjectAudit[] = [];
  for (const [dir, sessions] of byDir) {
    out.push({
      id: `opencode:${dir}`,
      name: dir,
      label: dir === "(unknown project)" ? dir : baseName(dir),
      realPath: dir,
      report: buildReport(sessions, []),
      sessions,
      serverList: [],
    });
  }
  out.sort((a, b) => b.report.totalCostUsd - a.report.totalCostUsd);
  return out;
}

export const opencodeAdapter: AgentAdapter = {
  id: "opencode",
  name: "OpenCode",
  supported: true,
  async detect(home) {
    try {
      await access(join(opencodeRoot(home), "storage", "message"));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: loadOpencodeProjects,
};
