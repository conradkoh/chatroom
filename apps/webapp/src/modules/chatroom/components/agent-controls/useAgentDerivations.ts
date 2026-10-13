'use client';

import { useMemo } from 'react';

import {
  deriveHarnessesOf,
  deriveHarnessVersionsOf,
  deriveRunningAgentConfig,
} from './derivations';
import type { AgentConfig, MachineInfo } from '../../types/machine';
import type { Workspace } from '../../types/workspace';

/** Memoized facts about the role, its configs, the running agent and the selected machine. */
export function useAgentDerivations({
  role,
  agentConfigs,
  workspaceId,
  chatroomWorkspaces,
  connectedMachines,
  runtimeIsRunning,
  selectedMachineId,
}: {
  role: string;
  agentConfigs: AgentConfig[];
  workspaceId?: string;
  chatroomWorkspaces?: Workspace[];
  connectedMachines: MachineInfo[];
  runtimeIsRunning: boolean;
  selectedMachineId: string | null;
}) {
  // Get configs for this role
  const roleConfigs = useMemo(() => {
    return agentConfigs.filter((c) => c.role.toLowerCase() === role.toLowerCase());
  }, [agentConfigs, role]);
  const preferredWorkspace = useMemo(
    () => chatroomWorkspaces?.find((workspace) => workspace._registryId === workspaceId),
    [chatroomWorkspaces, workspaceId]
  );
  const initializationWorkspaces = useMemo(
    () => (preferredWorkspace ? [preferredWorkspace] : chatroomWorkspaces),
    [chatroomWorkspaces, preferredWorkspace]
  );

  // Check if there's a running agent on a connected machine
  const runningAgentConfig = useMemo(
    () => deriveRunningAgentConfig(roleConfigs, connectedMachines, runtimeIsRunning),
    [roleConfigs, connectedMachines, runtimeIsRunning]
  );

  const availableHarnessesForMachine = useMemo(
    () => deriveHarnessesOf(connectedMachines, selectedMachineId),
    [selectedMachineId, connectedMachines]
  );
  const harnessVersionsForMachine = useMemo(
    () => deriveHarnessVersionsOf(connectedMachines, selectedMachineId),
    [selectedMachineId, connectedMachines]
  );

  return {
    roleConfigs,
    preferredWorkspace,
    initializationWorkspaces,
    runningAgentConfig,
    displayAgentConfig: runningAgentConfig,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
  };
}
