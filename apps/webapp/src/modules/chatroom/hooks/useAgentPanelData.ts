import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useDaemonConnectivity } from '../../../hooks/useDaemonConnectivity';
import { useAgentConfigs } from './useAgentConfigs';
import type { MachineInfo, AgentConfig } from '../types/machine';

export interface AgentRoleView {
  role: string; state: 'running' | 'stopped' | 'starting' | 'circuit_open'; type: 'remote' | 'custom'; machineId?: string; machineName?: string;
}

export interface AgentPanelData {
  agents: AgentRoleView[];
  teamRoles: string[];
  connectedMachines: MachineInfo[];
  machineConfigs: AgentConfig[];
  isLoading: boolean;
  sendCommand: ReturnType<typeof useSessionMutation>;
  teamId?: string;
  lifecycle: { teamId: string; teamName: string; expectedRoles: string[]; participants: Array<{ role: string; lastSeenAt: number | null; lastSeenAction: string | null; agentType: 'remote' | 'custom'; lastStatus: string | null; lastDesiredState: string | null; isAlive: boolean }>; hasHistory: boolean } | null;
}

export function useAgentPanelData(chatroomId: string, options?: { loadConfigs?: boolean }): AgentPanelData {
  const statusResult = useSessionQuery(api.machines.getAgentViewStatus, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const machineResult = useSessionQuery(api.machines.listMachines);

  const { configs: machineConfigs, isLoading: configsLoading } = useAgentConfigs(chatroomId, { enabled: options?.loadConfigs ?? false });

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

  const isLoading =
    statusResult === undefined || machineResult === undefined || configsLoading;

  const lifecycle = statusResult ? { teamId: statusResult.teamId, teamName: statusResult.teamName, expectedRoles: statusResult.teamRoles, participants: statusResult.agents.map((a) => ({ role: a.role, lastSeenAt: a.lastSeenAt, lastSeenAction: a.lastSeenAction, agentType: a.agentType, lastStatus: a.lastStatus, lastDesiredState: a.lastDesiredState, isAlive: a.isAlive })), hasHistory: statusResult.hasHistory } : null;

  return {
    agents,
    teamRoles,
    connectedMachines,
    machineConfigs,
    isLoading,
    sendCommand,
    teamId: statusResult?.teamId,
    lifecycle,
  };
}
