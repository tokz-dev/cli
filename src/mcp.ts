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
