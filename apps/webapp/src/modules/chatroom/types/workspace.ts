/**
 * Workspace types for the workspace sidebar and git panel.
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
  /** Machine alias set by the user (if any). Prefer displaying this over hostname. */
  machineAlias?: string;
  /** Absolute working directory path, or "" for unassigned agents */
  workingDir: string;
  /** Roles of agents that belong to this workspace */
  agentRoles: string[];
  /** ID from workspace registry, used for manual removal */
  _registryId?: string;
}

/**
 * Returns the display name for a workspace's machine: alias if set, otherwise hostname.
 */
export function getWorkspaceDisplayHostname(ws: { hostname: string; machineAlias?: string }): string {
  return ws.machineAlias || ws.hostname;
}
