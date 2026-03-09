import { useMemo } from 'react';

import type { TeamAgentConfig } from './useAgentPanelData';
import type { MachineInfo } from '../types/machine';
import type { Workspace, WorkspaceGroup } from '../types/workspace';

/** Minimal agent shape required for workspace derivation. */
interface AgentWithRole {
  role: string;
}

interface UseWorkspacesParams {
  agents: AgentWithRole[];
  /** keyed by role.toLowerCase() */
  teamConfigMap: Map<string, TeamAgentConfig>;
  connectedMachines: MachineInfo[];
}

interface UseWorkspacesResult {
  /** Workspaces grouped by machine — for sidebar rendering. */
  workspaceGroups: WorkspaceGroup[];
  /** Flat list of all workspaces — for selection lookup. */
  allWorkspaces: Workspace[];
}

/** Derives workspace groups and a flat workspace list from agents and their team configs. */
export function useWorkspaces(params: UseWorkspacesParams): UseWorkspacesResult {
  const { agents, teamConfigMap, connectedMachines } = params;

  return useMemo(() => {
    // Build hostname lookup from connectedMachines
    const hostnameMap = new Map(connectedMachines.map((m) => [m.machineId, m.hostname]));

    // Accumulate workspace entries
    const workspaceMap = new Map<string, Workspace>();
    const unassignedWorkspace: Workspace = {
      id: '__unassigned__',
      machineId: null,
      hostname: 'Unassigned',
      workingDir: '',
      agentRoles: [],
    };

    for (const agent of agents) {
      const config = teamConfigMap.get(agent.role.toLowerCase());

      if (!config?.machineId || !config?.workingDir) {
        // Agent has no machine or workingDir → Unassigned
        unassignedWorkspace.agentRoles.push(agent.role);
        continue;
      }

      const wsId = `${config.machineId}::${config.workingDir}`;
      if (!workspaceMap.has(wsId)) {
        workspaceMap.set(wsId, {
          id: wsId,
          machineId: config.machineId,
          hostname: hostnameMap.get(config.machineId) ?? config.machineId.slice(0, 8),
          workingDir: config.workingDir,
          agentRoles: [],
        });
      }
      workspaceMap.get(wsId)!.agentRoles.push(agent.role);
    }

    // Build workspace list (exclude unassigned for grouping)
    const assignedWorkspaces = Array.from(workspaceMap.values());

    // Group assigned workspaces by machineId
    const machineGroupMap = new Map<string, WorkspaceGroup>();
    for (const ws of assignedWorkspaces) {
      const machineId = ws.machineId!;
      if (!machineGroupMap.has(machineId)) {
        machineGroupMap.set(machineId, {
          machineId,
          hostname: ws.hostname,
          workspaces: [],
        });
      }
      machineGroupMap.get(machineId)!.workspaces.push(ws);
    }

    const workspaceGroups: WorkspaceGroup[] = Array.from(machineGroupMap.values());

    // Append "Unassigned" group at the end, only if there are unassigned agents
    if (unassignedWorkspace.agentRoles.length > 0) {
      workspaceGroups.push({
        machineId: null,
        hostname: 'Unassigned',
        workspaces: [unassignedWorkspace],
      });
    }

    const allWorkspaces: Workspace[] = [
      ...assignedWorkspaces,
      ...(unassignedWorkspace.agentRoles.length > 0 ? [unassignedWorkspace] : []),
    ];

    return { workspaceGroups, allWorkspaces };
  }, [agents, teamConfigMap, connectedMachines]);
}
