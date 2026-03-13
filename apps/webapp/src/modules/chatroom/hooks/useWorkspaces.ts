import { useMemo } from 'react';

import type { WorkspaceView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import type { Workspace, WorkspaceGroup } from '../types/workspace';

/** Minimal agent shape required for workspace derivation. */
interface AgentWithRole {
  role: string;
}

interface UseWorkspacesParams {
  agents: AgentWithRole[];
  /** Backend-computed workspace views from getAgentStatus. */
  backendWorkspaces: WorkspaceView[];
}

interface UseWorkspacesResult {
  /** Workspaces grouped by machine — for sidebar rendering. */
  workspaceGroups: WorkspaceGroup[];
  /** Flat list of all workspaces — for selection lookup. */
  allWorkspaces: Workspace[];
}

/** Derives workspace groups and a flat workspace list from backend workspace views and agents. */
export function useWorkspaces(params: UseWorkspacesParams): UseWorkspacesResult {
  const { agents, backendWorkspaces } = params;

  return useMemo(() => {
    const workspaceMap = new Map<string, Workspace>();
    const unassignedWorkspace: Workspace = {
      id: '__unassigned__',
      machineId: null,
      hostname: 'Unassigned',
      workingDir: '',
      agentRoles: [],
    };

    // Build workspaces from backend data
    for (const bw of backendWorkspaces) {
      const wsId = `${bw.hostname}::${bw.workingDir}`;
      workspaceMap.set(wsId, {
        id: wsId,
        machineId: bw.machineId,
        hostname: bw.hostname,
        workingDir: bw.workingDir,
        agentRoles: [...bw.agentRoles],
      });
    }

    // Find agents not in any backend workspace → add to Unassigned
    const assignedRoles = new Set(backendWorkspaces.flatMap((w) => w.agentRoles));
    for (const agent of agents) {
      if (!assignedRoles.has(agent.role)) {
        unassignedWorkspace.agentRoles.push(agent.role);
      }
    }

    const assignedWorkspaces = Array.from(workspaceMap.values());

    // Group assigned workspaces by hostname
    const hostnameGroupMap = new Map<string, WorkspaceGroup>();
    for (const ws of assignedWorkspaces) {
      const key = ws.hostname;
      if (!hostnameGroupMap.has(key)) {
        hostnameGroupMap.set(key, {
          machineId: ws.machineId,
          hostname: ws.hostname,
          workspaces: [],
        });
      }
      hostnameGroupMap.get(key)!.workspaces.push(ws);
    }

    const workspaceGroups: WorkspaceGroup[] = Array.from(hostnameGroupMap.values());

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
  }, [agents, backendWorkspaces]);
}
