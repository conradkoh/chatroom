'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { getPermanentRoleNames } from '@workspace/shared/domain/agent-role';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useDaemonConnectivity } from '../../../hooks/useDaemonConnectivity';
import { useChatroomWorkspace } from '../context/ChatroomWorkspaceContext';
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

/**
 * Builds the workspace agent list from structural team roles plus optional
 * workspace configuration. Team roles provide candidate cards; configured
 * rows enrich/override those candidates when they exist.
 */
function mergeWorkspaceAgentRoles(
  configuredAgents: readonly WorkspaceAgentRole[],
  teamRoles: readonly string[],
  teamId: string | null | undefined
): WorkspaceAgentRole[] {
  const permanentRoles = getPermanentRoleNames(
    teamRoles.filter((role) => role.toLowerCase() !== 'user')
  );
  const merged = new Map<string, WorkspaceAgentRole>();
  const resolvedTeamId = teamId ?? configuredAgents[0]?.teamId ?? null;

  for (const role of permanentRoles) {
    merged.set(role.toLowerCase(), {
      role,
      type: 'remote',
      teamId: resolvedTeamId,
    });
  }
  for (const agent of configuredAgents) {
    merged.set(agent.role.toLowerCase(), agent);
  }
  return [...merged.values()].sort((a, b) => a.role.localeCompare(b.role));
}

/** Low-frequency agent directory query for one workspace. */
function useWorkspaceAgents(workspaceId: string | null) {
  const { chatroomId } = useChatroomWorkspace();
  const result = useSessionQuery(
    api.agents.listLastSentLaunchRequests,
    workspaceId
      ? {
          chatroomId,
          workspaceId: workspaceId as Id<'chatroom_workspaces'>,
        }
      : 'skip'
  );

  return {
    requests: result ?? [],
    isLoading: workspaceId !== null && result === undefined,
  };
}

/** High-frequency status projection for one workspace/role pair. */
export function useWorkspaceAgentStatus(workspaceId: string | null, role: string) {
  const { chatroomId } = useChatroomWorkspace();
  const result = useSessionQuery(
    api.agents.getStatus,
    workspaceId
      ? {
          chatroomId,
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
  const { chatroomId } = useChatroomWorkspace();
  const result = useSessionQuery(
    api.agents.getLastSentLaunchRequest,
    workspaceId
      ? {
          chatroomId,
          workspaceId: workspaceId as Id<'chatroom_workspaces'>,
          role,
        }
      : 'skip'
  );

  return {
    config: result
      ? {
          role: result.role,
          type: result.agentType,
          machineId: result.machineId,
          agentHarness: result.agentHarness,
          model: result.model,
          workingDir: result.workingDir,
          updatedAt: result.requestedAt,
        }
      : null,
    isLoading: workspaceId !== null && result === undefined,
  };
}

/** Composes team-role candidates with low-frequency workspace configuration data. */
export function useWorkspaceAgentDirectory() {
  const { chatroomId, activeWorkspace, isLoading: isLoadingWorkspace } = useChatroomWorkspace();
  const teamStructure = useSessionQuery(api.chatrooms.getTeamStructureForChatroom, {
    chatroomId,
  });
  const { requests: configuredRequests, isLoading: isLoadingAgents } = useWorkspaceAgents(
    activeWorkspace?._registryId ?? null
  );

  const agents = useMemo(
    () =>
      mergeWorkspaceAgentRoles(
        configuredRequests.map((request) => ({
          role: request.role,
          type: request.agentType,
          teamId: teamStructure?.teamId ?? null,
        })),
        (teamStructure?.roles ?? []).map(({ role }) => role),
        teamStructure?.teamId
      ),
    [configuredRequests, teamStructure]
  );

  return {
    workspace: activeWorkspace,
    agents,
    isLoading: isLoadingWorkspace || isLoadingAgents || teamStructure === undefined,
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
