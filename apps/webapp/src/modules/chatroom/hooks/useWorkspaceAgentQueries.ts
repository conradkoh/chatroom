'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useAgentCommandSender } from './useAgentCommandSender';
import { useChatroomTeam } from './useChatroomTeam';
import { useDaemonConnectivity } from '../../../hooks/useDaemonConnectivity';
import { useChatroomWorkspace } from '../context/ChatroomWorkspaceContext';
import type { AgentConfig, MachineInfo } from '../types/machine';
import { getWorkspaceAgentRoles } from '../utils/workspaceAgentRoles';

export type { WorkspaceAgentRole } from '../utils/workspaceAgentRoles';

export interface WorkspaceAgentStatus {
  role: string;
  status: 'offline' | 'starting' | 'waiting' | 'working' | 'stopping' | 'error';
  isRunning: boolean;
  lastSeenAt: number | null;
  lastSeenAction: string | null;
  activeWork: { kind: 'task'; id: string } | { kind: 'enhancer_job'; id: string } | null;
  error: {
    source: 'configuration' | 'runtime' | 'task' | 'enhancer' | 'stop';
    code: string;
    message: string;
    occurredAt: number;
  } | null;
  projectedAt: number;
  workingDir: string;
}

/** High-frequency status projection for one workspace/role pair. */
export function useWorkspaceAgentStatus(workspaceId: string | null, role: string) {
  const result = useSessionQuery(
    api.agentWorkspaces.getAgentStatusForWorkspaceRole,
    workspaceId
      ? {
          workspaceId: workspaceId as Id<'chatroom_workspaces'>,
          role,
        }
      : 'skip'
  );

  return {
    status: (result ?? null) as WorkspaceAgentStatus | null,
    isLoading: workspaceId !== null && result === undefined,
  };
}

/** Low-frequency configuration query for one workspace/role pair. */
export function useWorkspaceAgentConfig(workspaceId: string | null, role: string) {
  const workspaceResult = useSessionQuery(
    api.agentWorkspaces.getAgentConfigForWorkspaceRole,
    workspaceId
      ? {
          workspaceId: workspaceId as Id<'chatroom_workspaces'>,
          role,
        }
      : 'skip'
  );
  const result = workspaceId ? workspaceResult : null;

  return {
    config: result
      ? {
          role: result.role,
          type: result.type,
          machineId: result.machineId,
          agentHarness: result.agentHarness,
          model: result.model,
          workingDir: result.workingDir,
          updatedAt: result.updatedAt,
        }
      : null,
    isLoading: workspaceId !== null && result === undefined,
  };
}

/** Composes the workspace agent directory from the assigned team's structure. */
export function useWorkspaceAgentDirectory() {
  const { chatroomId, activeWorkspace, isLoading: isLoadingWorkspace } = useChatroomWorkspace();
  const { structure: teamStructure, isLoading: isLoadingTeam } = useChatroomTeam(chatroomId);
  const agents = useMemo(() => getWorkspaceAgentRoles(teamStructure), [teamStructure]);

  return {
    workspace: activeWorkspace,
    agents,
    isLoading: isLoadingWorkspace || isLoadingTeam,
  };
}

/** Control-only machine data. It is not used to decide which agents exist or their status. */
export function useWorkspaceAgentControlData() {
  const result = useSessionQuery(api.machines.listMachines);
  const sendCommand = useAgentCommandSender();
  const machines = useMemo<MachineInfo[]>(
    () => (result?.machines ?? []) as MachineInfo[],
    [result?.machines]
  );
  const daemonConnectivity = useDaemonConnectivity();

  return {
    machines,
    daemonConnectivity,
    agentConfigs: [] as AgentConfig[],
    isLoadingMachines: result === undefined,
    sendCommand,
  };
}
