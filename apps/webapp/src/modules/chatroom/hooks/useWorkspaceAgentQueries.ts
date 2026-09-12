'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useDaemonConnectivity } from '../../../hooks/useDaemonConnectivity';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../types/machine';

export interface WorkspaceAgentRole {
  role: string;
  type: 'remote' | 'custom';
  teamId: string | null;
}

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

export interface WorkspaceAgentConfig {
  role: string;
  type: 'remote' | 'custom';
  machineId: string | null;
  agentHarness: string | null;
  model: string | null;
  workingDir: string | null;
  desiredState: 'running' | 'stopped' | null;
  updatedAt: number;
}

/** Low-frequency workspace selection query. */
function useActiveWorkspaceForChatroom(chatroomId: string) {
  const result = useSessionQuery(api.workspaces.getActiveWorkspaceForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  return {
    workspace: result ?? null,
    isLoading: result === undefined,
  };
}

/** Low-frequency agent directory query for one workspace. */
function useWorkspaceAgents(workspaceId: string | null) {
  const result = useSessionQuery(
    api.agentWorkspaces.listAgentsForWorkspace,
    workspaceId ? { workspaceId: workspaceId as Id<'chatroom_workspaces'> } : 'skip'
  );

  return {
    agents: (result ?? []) as WorkspaceAgentRole[],
    isLoading: workspaceId !== null && result === undefined,
  };
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
  const result = useSessionQuery(
    api.agentWorkspaces.getAgentConfigForWorkspaceRole,
    workspaceId
      ? {
          workspaceId: workspaceId as Id<'chatroom_workspaces'>,
          role,
        }
      : 'skip'
  );

  return {
    config: (result ?? null) as WorkspaceAgentConfig | null,
    isLoading: workspaceId !== null && result === undefined,
  };
}

/** Composes only the low-frequency active-workspace and agent-directory queries. */
export function useWorkspaceAgentDirectory(chatroomId: string) {
  const { workspace, isLoading: isLoadingWorkspace } = useActiveWorkspaceForChatroom(chatroomId);
  const { agents, isLoading: isLoadingAgents } = useWorkspaceAgents(workspace?._id ?? null);

  return {
    workspace,
    agents,
    isLoading: isLoadingWorkspace || isLoadingAgents,
  };
}

/** Control-only machine data. It is not used to decide which agents exist or their status. */
export function useWorkspaceAgentControlData() {
  const result = useSessionQuery(api.machines.listMachines);
  const sendCommand = useSessionMutation(api.machines.sendCommand);
  const machines = useMemo<MachineInfo[]>(
    () => (result?.machines ?? []) as MachineInfo[],
    [result?.machines]
  );
  const daemonConnectivity = useDaemonConnectivity(machines.map((machine) => machine.machineId));

  return {
    machines,
    daemonConnectivity,
    agentConfigs: [] as AgentConfig[],
    isLoadingMachines: result === undefined,
    sendCommand: sendCommand as unknown as SendCommandFn,
  };
}
