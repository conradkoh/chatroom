import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { AgentRoleView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useDaemonConnectivity } from '../../../hooks/useDaemonConnectivity';
import type { MachineInfo, AgentConfig } from '../types/machine';

export type { AgentRoleView };

export interface AgentPanelData {
  agents: AgentRoleView[];
  teamRoles: string[];
  connectedMachines: MachineInfo[];
  machineConfigs: AgentConfig[];
  isLoading: boolean;
  sendCommand: ReturnType<typeof useSessionMutation>;
  teamId?: string;
}

export function useAgentPanelData(chatroomId: string): AgentPanelData {
  const statusResult = useSessionQuery(api.machines.getAgentStatus, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const machineResult = useSessionQuery(api.machines.listMachines);

  const machineConfigResult = useSessionQuery(api.machines.getMachineAgentConfigs, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
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

  const machineConfigs = useMemo<AgentConfig[]>(
    () => (machineConfigResult?.configs ?? []) as AgentConfig[],
    [machineConfigResult?.configs]
  );

  const isLoading =
    statusResult === undefined || machineResult === undefined || machineConfigResult === undefined;

  return {
    agents,
    teamRoles,
    connectedMachines,
    machineConfigs,
    isLoading,
    sendCommand,
    teamId: statusResult?.teamId,
  };
}
