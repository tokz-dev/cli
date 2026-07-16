import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadProjects } from "../projects.js";
import type { AgentAdapter } from "./types.js";

export const claudeAdapter: AgentAdapter = {
  id: "claude",
  name: "Claude Code",
  supported: true,
  async detect(home = homedir()) {
    try {
      await access(join(home, ".claude", "projects"));
      return true;
    } catch {
      return false;
    }
  },
  loadProjects: (home, onProgress) => loadProjects(home, onProgress),
};
