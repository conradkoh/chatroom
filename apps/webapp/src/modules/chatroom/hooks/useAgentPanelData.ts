import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import type { TeamStructure } from '@workspace/shared/domain/team-presets';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useAgentConfigs } from './useAgentConfigs';
import { useDaemonConnectivity } from '../../../hooks/useDaemonConnectivity';
import { useChatroomListing } from '../context/ChatroomListingContext';
import type { MachineInfo, AgentConfig } from '../types/machine';

export interface AgentRoleView {
  role: string;
  state: 'running' | 'stopped' | 'starting' | 'circuit_open';
  type: 'remote' | 'custom';
  machineId?: string;
  machineName?: string;
  model?: string;
  stopState?: 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed';
  activeStopCommandId?: string;
}

export interface AgentPanelData {
  agents: AgentRoleView[];
  teamRoles: string[];
  connectedMachines: MachineInfo[];
  machineConfigs: AgentConfig[];
  isLoading: boolean;
  remoteAgentStatus: 'running' | 'stopped' | 'none' | undefined;
  teamStructure: TeamStructure | null | undefined;
  sendCommand: ReturnType<typeof useSessionMutation>;
  teamId?: string;
  lifecycle: {
    teamId: string;
    teamName: string;
    expectedRoles: string[];
    participants: {
      role: string;
      lastSeenAt: number | null;
      lastSeenAction: string | null;
    }[];
    hasHistory: boolean;
  } | null;
  statusReadModel: AgentRoleStatusReadModel[] | undefined;
}

export type AgentRoleStatusReadModel = Pick<
  Doc<'chatroom_agentRoleStatusReadModel'>,
  | 'role'
  | 'roleKind'
  | 'status'
  | 'machineId'
  | 'lastSeenAt'
  | 'activeWork'
  | 'error'
  | 'projectedAt'
>;

// fallow-ignore-next-line complexity
export function useAgentPanelDataSubscriptions(
  chatroomId: string,
  options?: { loadConfigs?: boolean }
): AgentPanelData {
  const statusResult = useSessionQuery(api.machines.getAgentViewStatus, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const statusReadModelResult = useSessionQuery(api.machines.getAgentRoleStatusReadModel, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const { chatrooms } = useChatroomListing();
  const remoteAgentStatus = useMemo(
    () => chatrooms?.find((c) => c._id === chatroomId)?.remoteAgentStatus,
    [chatrooms, chatroomId]
  );
  const teamStructure = useSessionQuery(api.chatrooms.getTeamStructureForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const machineResult = useSessionQuery(api.machines.listMachines);

  const { configs: machineConfigs, isLoading: configsLoading } = useAgentConfigs(chatroomId, {
    enabled: options?.loadConfigs ?? false,
  });

  const sendCommand = useSessionMutation(api.machines.sendCommand);

  const agents = useMemo<AgentRoleView[]>(() => statusResult?.agents ?? [], [statusResult?.agents]);

  const teamRoles = useMemo<string[]>(
    () => statusResult?.teamRoles ?? [],
    [statusResult?.teamRoles]
  );

  const allMachines = useMemo<MachineInfo[]>(
    () => (machineResult?.machines ?? []) as MachineInfo[],
    [machineResult?.machines]
  );

  const allMachineIds = useMemo(() => allMachines.map((m) => m.machineId), [allMachines]);

  // Per-machine daemon connectivity — lightweight, heartbeat-driven subscription
  // that does NOT invalidate the heavier listMachines subscription.
  const daemonConnectivity = useDaemonConnectivity(allMachineIds);

  // Filter to machines where the daemon is currently connected.
  const connectedMachines = useMemo<MachineInfo[]>(
    () => allMachines.filter((m) => daemonConnectivity.get(m.machineId)?.connected === true),
    [allMachines, daemonConnectivity]
  );

  const isLoading = statusResult === undefined || machineResult === undefined || configsLoading;

  const lifecycle = statusResult
    ? {
        teamId: statusResult.teamId,
        teamName: statusResult.teamName,
        expectedRoles: statusResult.teamRoles,
        participants: statusResult.teamRoles
          .filter((role) => role.toLowerCase() !== 'user')
          .map((role) => {
            const row = statusReadModelResult?.find(
              (status) => status.role.toLowerCase() === role.toLowerCase()
            );
            return { role, lastSeenAt: row?.lastSeenAt ?? null, lastSeenAction: null };
          }),
        hasHistory: statusResult.hasHistory,
      }
    : null;

  return {
    agents,
    teamRoles,
    connectedMachines,
    machineConfigs,
    isLoading,
    remoteAgentStatus,
    teamStructure,
    sendCommand,
    teamId: statusResult?.teamId,
    lifecycle,
    statusReadModel: statusReadModelResult,
  };
}

export { useAgentPanelData } from '../context/AgentPanelDataContext';
