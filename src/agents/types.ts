import type { LoadProgress, ProjectAudit } from "../projects.js";

export interface AgentAdapter {
  id: string;
  /** display name, e.g. "Claude Code" */
  name: string;
  /** true when this agent's data directory exists on this machine */
  detect(home?: string): Promise<boolean>;
  /** parse all of this agent's local data into per-project audits */
  loadProjects(home?: string, onProgress?: (p: LoadProgress) => void): Promise<ProjectAudit[]>;
  /** false for agents we can detect but whose session format we can't parse yet */
  supported: boolean;
}

export interface AgentData {
  adapter: AgentAdapter;
  detected: boolean;
  projects: ProjectAudit[];
}
