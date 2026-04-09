import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { AgentRoleView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo, useCallback, useState, useEffect } from 'react';

import type { AgentPreference } from '../components/AgentConfigTabs';
import type { MachineInfo, AgentConfig } from '../types/machine';

export type { AgentRoleView };

export interface AgentPanelData {
  agents: AgentRoleView[];
  teamRoles: string[];
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

  const agents = useMemo<AgentRoleView[]>(() => statusResult?.agents ?? [], [statusResult?.agents]);

  const teamRoles = useMemo<string[]>(
    () => statusResult?.teamRoles ?? [],
    [statusResult?.teamRoles]
  );

  const connectedMachines = useMemo<MachineInfo[]>(
    () => ((machineResult?.machines ?? []) as MachineInfo[]).filter((m) => m.daemonConnected),
    [machineResult?.machines]
  );

  const machineConfigs = useMemo<AgentConfig[]>(
    () => (machineConfigResult?.configs ?? []) as AgentConfig[],
    [machineConfigResult?.configs]
  );

  // Load preferences once, then unsubscribe — preferences are snapshotted at mount
  // by useAgentControls and don't need reactive updates.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const preferencesResult = useSessionQuery(
    api.machines.getAgentPreferences,
    prefsLoaded ? 'skip' : { chatroomId: chatroomId as Id<'chatroom_rooms'> }
  );

  useEffect(() => {
    if (preferencesResult !== undefined && !prefsLoaded) {
      setPrefsLoaded(true);
    }
  }, [preferencesResult, prefsLoaded]);

  const agentPreferenceMap = useMemo(() => {
    const map = new Map<string, AgentPreference>();
    if (preferencesResult?.preferences) {
      for (const pref of preferencesResult.preferences) {
        map.set(pref.role, {
          role: pref.role,
          machineId: pref.machineId,
          agentHarness: pref.agentHarness,
          model: pref.model,
          workingDir: pref.workingDir,
        });
      }
    }
    return map;
  }, [preferencesResult?.preferences]);

  const isLoading =
    statusResult === undefined ||
    machineResult === undefined ||
    machineConfigResult === undefined ||
    (!prefsLoaded && preferencesResult === undefined);

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
    connectedMachines,
    machineConfigs,
    agentPreferenceMap,
    isLoading,
    sendCommand,
    savePreference,
  };
}
