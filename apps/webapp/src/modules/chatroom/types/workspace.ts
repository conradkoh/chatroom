/**
 * Workspace types for the All Agents panel.
 *
 * A workspace is a unique combination of machine + working directory.
 * Agents are grouped into workspaces based on their registered machineId + workingDir.
 */

/** A single workspace: one machine + working directory combination. */
export interface Workspace {
  /** Unique key: `${machineId}::${workingDir}` or `__unassigned__` */
  id: string;
  machineId: string | null;
  /** Human-readable hostname resolved from connected machines, or "Unassigned" */
  hostname: string;
  /** Absolute working directory path, or "" for unassigned agents */
  workingDir: string;
  /** Roles of agents that belong to this workspace */
  agentRoles: string[];
}

/** Workspaces grouped under a single machine — for sidebar rendering. */
export interface WorkspaceGroup {
  machineId: string | null;
  hostname: string;
  workspaces: Workspace[];
}
