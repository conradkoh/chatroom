import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type {
  AgentRoleView,
  WorkspaceView,
} from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo, useCallback } from 'react';
import type { MachineInfo, AgentConfig } from '../types/machine';
import type { AgentPreference } from '../components/AgentConfigTabs';

export type { AgentRoleView, WorkspaceView };

export interface AgentPanelData {
  agents: AgentRoleView[];
  teamRoles: string[];
  workspaces: WorkspaceView[];
  connectedMachines: MachineInfo[];
  machineConfigs: AgentConfig[];
  agentPreferenceMap: Map<string, AgentPreference>;
  isLoading: boolean;
  sendCommand: ReturnType<typeof useSessionMutation>;
  savePreference: (pref: AgentPreference) => void;
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
  const saveAgentPreference = useSessionMutation(api.machines.saveAgentPreference);

  const agents = useMemo<AgentRoleView[]>(
    () => statusResult?.agents ?? [],
    [statusResult?.agents]
  );

  const teamRoles = useMemo<string[]>(
    () => statusResult?.teamRoles ?? [],
    [statusResult?.teamRoles]
  );

  const workspaces = useMemo<WorkspaceView[]>(
    () => statusResult?.workspaces ?? [],
    [statusResult?.workspaces]
  );

  const connectedMachines = useMemo<MachineInfo[]>(
    () => ((machineResult?.machines ?? []) as MachineInfo[]).filter((m) => m.daemonConnected),
    [machineResult?.machines]
  );

  const machineConfigs = useMemo<AgentConfig[]>(
    () => (machineConfigResult?.configs ?? []) as AgentConfig[],
    [machineConfigResult?.configs]
  );

  const agentPreferenceMap = useMemo(() => {
    return new Map<string, AgentPreference>();
  }, []);

  const isLoading =
    statusResult === undefined ||
    machineResult === undefined ||
    machineConfigResult === undefined;

  const savePreference = useCallback(
    (pref: AgentPreference) => {
      saveAgentPreference({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        role: pref.role,
        machineId: pref.machineId,
        agentHarness: pref.agentHarness,
        model: pref.model,
        workingDir: pref.workingDir,
      }).catch((err) => {
        console.error('[AgentPanel] Failed to save preference:', err);
      });
    },
    [saveAgentPreference, chatroomId]
  );

  return {
    agents,
    teamRoles,
    workspaces,
    connectedMachines,
    machineConfigs,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  };
}
