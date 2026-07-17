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
  /** shown in the picker for detected-but-unsupported agents (why there's no data) */
  unsupportedReason?: string;
  /** true when this agent's numbers are estimates, not exact billed usage */
  estimated?: boolean;
  /** shown wherever this agent's data appears, explaining the estimate */
  estimateNote?: string;
}

export interface AgentData {
  adapter: AgentAdapter;
  detected: boolean;
  projects: ProjectAudit[];
}
