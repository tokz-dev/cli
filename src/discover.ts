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
