import type { Workspace, WorkspaceGroup } from '../types/workspace';
import { getWorkspaceDisplayHostname } from '../types/workspace';

interface AgentRole {
  role: string;
}

/**
 * Groups workspaces by display hostname (alias if set, otherwise hostname)
 * and appends an `__unassigned__` group for agents that don't belong to any workspace.
 *
 * Shared between AgentSettingsModal (WorkspacesContent) and UnifiedAgentListModal.
 */
export function buildWorkspaceGroups(
  allWorkspaces: Workspace[],
  agentRoles: AgentRole[]
): WorkspaceGroup[] {
  const groupMap = new Map<string, WorkspaceGroup>();

  for (const ws of allWorkspaces) {
    const key = getWorkspaceDisplayHostname(ws);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        machineId: ws.machineId,
        hostname: getWorkspaceDisplayHostname(ws),
        workspaces: [],
      });
    }
    groupMap.get(key)!.workspaces.push(ws);
  }

  // Unassigned agents — roles not present in any workspace
  const assignedRoles = new Set(allWorkspaces.flatMap((w) => w.agentRoles));
  const unassignedRoles = agentRoles.filter((a) => !assignedRoles.has(a.role)).map((a) => a.role);

  if (unassignedRoles.length > 0) {
    const unassignedWs: Workspace = {
      id: '__unassigned__',
      machineId: null,
      hostname: 'Unassigned',
      workingDir: '',
      agentRoles: unassignedRoles,
    };
    groupMap.set('__unassigned__', {
      machineId: null,
      hostname: 'Unassigned',
      workspaces: [unassignedWs],
    });
  }

  return Array.from(groupMap.values());
}
