import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo, useCallback } from 'react';
import type { MachineInfo, AgentConfig, AgentHarness } from '../types/machine';
import type { AgentPreference } from '../components/AgentConfigTabs';

export interface TeamAgentConfig {
  role: string;
  type: 'remote' | 'custom';
  machineId?: string;
  agentHarness?: AgentHarness;
  model?: string;
  workingDir?: string;
}

export interface AgentPanelData {
  connectedMachines: MachineInfo[];
  machineConfigs: AgentConfig[];
  teamConfigMap: Map<string, TeamAgentConfig>;
  agentPreferenceMap: Map<string, AgentPreference>;
  isLoading: boolean;
  sendCommand: ReturnType<typeof useSessionMutation>;
  savePreference: (pref: AgentPreference) => void;
}

export function useAgentPanelData(chatroomId: string): AgentPanelData {
  const panelResult = useSessionQuery(api.machines.getAgentPanel, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const sendCommand = useSessionMutation(api.machines.sendCommand);
  const saveAgentPreference = useSessionMutation(api.machines.saveAgentPreference);

  const connectedMachines = useMemo<MachineInfo[]>(
    () => ((panelResult?.machines ?? []) as MachineInfo[]).filter((m) => m.daemonConnected),
    [panelResult?.machines]
  );

  const machineConfigs = useMemo<AgentConfig[]>(
    () => (panelResult?.machineConfigs ?? []) as AgentConfig[],
    [panelResult?.machineConfigs]
  );

  const teamConfigMap = useMemo(() => {
    if (!panelResult?.teamConfigs) return new Map<string, TeamAgentConfig>();
    return new Map(
      (panelResult.teamConfigs as TeamAgentConfig[]).map((c) => [c.role.toLowerCase(), c])
    );
  }, [panelResult?.teamConfigs]);

  const agentPreferenceMap = useMemo(() => {
    if (!panelResult?.preferences) return new Map<string, AgentPreference>();
    return new Map(
      (panelResult.preferences as AgentPreference[]).map((p) => [p.role.toLowerCase(), p])
    );
  }, [panelResult?.preferences]);

  const isLoading = panelResult === undefined;

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
    connectedMachines,
    machineConfigs,
    teamConfigMap,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  };
}
