/** Minimal workspace shape needed for setup resume. */
export interface SetupWorkspaceCandidate {
  machineId: string;
  workingDir: string;
  registeredAt?: number;
}

export interface PickedSetupWorkspace {
  machineId: string;
  workingDir: string;
}

/**
 * Pick the workspace to resume setup from.
 * Returns null when no valid candidate exists.
 * Picks the most recently registered workspace (registeredAt desc).
 */
export function pickSetupWorkspace(
  workspaces: readonly SetupWorkspaceCandidate[]
): PickedSetupWorkspace | null {
  const valid = workspaces.filter((ws) => ws.machineId && ws.workingDir?.trim());
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
  const top = sorted[0];
  if (!top) return null;
  return { machineId: top.machineId, workingDir: top.workingDir };
}
