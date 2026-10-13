'use client';

import { useCallback, useMemo, useState } from 'react';

import {
  currentIsFavorite,
  deriveDisplayValues,
  deriveModelUnavailable,
  deriveRecommendedConfigs,
} from './remoteTabDerivations';
import { useMachineConfigFavorites } from '../../features/machine-config/hooks/useMachineConfigFavorites';
import { useMachineConfigUsage } from '../../features/machine-config/hooks/useMachineConfigUsage';
import { buildMachineConfigScopeKey } from '../../features/machine-config/lib/machineConfigScopeKey';
import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import {
  formatHarnessLabel,
  getMachineDisplayName,
  type AgentHarness,
  type HarnessVersionInfo,
  type MachineInfo,
} from '../../types/machine';
import { useChatroomWorkspaces } from '../../workspace/hooks/useChatroomWorkspaces';
import type { useAgentControls } from '../AgentControls';
import { useHarnessModelPicker } from '../model-selection';
import { usePickerSearchState, filterPickerItems } from '../picker';

/** True when loading has finished and no machine is connected. */
function deriveHasNoMachines(isLoadingMachines: boolean, connectedCount: number): boolean {
  return !isLoadingMachines && connectedCount === 0;
}

export interface UseRemoteTabModelArgs {
  controls: ReturnType<typeof useAgentControls>;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  chatroomId: string;
  role: string;
  /** When provided, skips a duplicate workspace registry subscription in this tab. */
  linkedMachineIdsProp?: ReadonlySet<string>;
}

/**
 * The state and derived values behind the Remote tab. The picker popovers stay in this hook, so
 * their open state and search survive a loading flicker, as before.
 */
export function useRemoteTabModel({
  controls,
  connectedMachines,
  isLoadingMachines,
  chatroomId,
  role,
  linkedMachineIdsProp,
}: UseRemoteTabModelArgs) {
  const {
    selectedMachineId,
    selectedHarness,
    selectedModel,
    workingDir,
    displayAgentConfig,
    availableHarnessesForMachine,
    harnessVersionsForMachine,
    availableModelsForHarness,
    teamId,
    hasModels,
    handleHarnessChange,
    handleModelChange,
    isAgentRunning,
  } = controls;

  // When an agent is running, display values come exclusively from the running config.
  const display = deriveDisplayValues(displayAgentConfig, {
    machineId: selectedMachineId,
    harness: selectedHarness,
    model: selectedModel,
    workingDir,
  });
  const displayMachineId = display.machineId;
  const displayHarness = display.harness;
  const displayModel = display.model;

  // Machine config favorites + recommendations (scoped by machine+team+role)
  const favoriteScope = useMemo(() => {
    if (!displayMachineId || !teamId) return undefined;
    return { machineId: displayMachineId, chatroomId, teamId, role };
  }, [displayMachineId, chatroomId, teamId, role]);

  const machineConfigScopeKey = useMemo(
    () =>
      favoriteScope
        ? buildMachineConfigScopeKey(
            favoriteScope.machineId,
            favoriteScope.teamId,
            favoriteScope.role
          )
        : undefined,
    [favoriteScope]
  );

  const { favorites, addFavorite, removeFavorite, moveFavorite, isFavorite } =
    useMachineConfigFavorites(favoriteScope);

  const {
    usageForScope: machineConfigUsage,
    recordUsage: recordMachineConfigUsageOnApply,
    clearUsage: clearMachineConfigUsage,
  } = useMachineConfigUsage(machineConfigScopeKey);

  const recommended = useMemo(
    () =>
      deriveRecommendedConfigs({
        scopeKey: machineConfigScopeKey,
        usage: machineConfigUsage,
        favorites,
        availableHarnesses: availableHarnessesForMachine,
        displayHarness,
        displayModel,
      }),
    [
      machineConfigScopeKey,
      machineConfigUsage,
      displayHarness,
      displayModel,
      favorites,
      availableHarnessesForMachine,
    ]
  );

  const currentEntry = useMemo(() => {
    if (!displayHarness || !displayModel) return null;
    return { agentHarness: displayHarness, model: displayModel };
  }, [displayHarness, displayModel]);

  const currentEntryIsFavorite = currentIsFavorite(currentEntry, isFavorite);

  const handleApplyMachineConfig = useCallback(
    (entry: { agentHarness: AgentHarness; model: string }) => {
      handleHarnessChange(entry.agentHarness);
      handleModelChange(entry.model, entry.agentHarness);
      recordMachineConfigUsageOnApply(entry);
    },
    [handleHarnessChange, handleModelChange, recordMachineConfigUsageOnApply]
  );

  const handleDismissRecommended = useCallback(
    (entry: MachineConfigEntry) => {
      clearMachineConfigUsage(entry);
    },
    [clearMachineConfigUsage]
  );

  // Harness version lookup must use `displayMachineId` — when an agent is running,
  // `selectedMachineId` (form state) may still point to the same machine, but
  // `runningAgentConfig.machineId` is authoritative and may differ. Using
  // `displayMachineId` ensures the version label is always consistent with the
  // harness shown in the button.
  const displayHarnessVersionsForMachine = useMemo(() => {
    if (!displayMachineId) return {} as Partial<Record<AgentHarness, HarnessVersionInfo>>;
    const machine = connectedMachines.find((m) => m.machineId === displayMachineId);
    return machine?.harnessVersions ?? {};
  }, [displayMachineId, connectedMachines]);

  const hasNoMachines = deriveHasNoMachines(isLoadingMachines, connectedMachines.length);

  const { workspaces: chatroomWorkspaces } = useChatroomWorkspaces(chatroomId, {
    skip: linkedMachineIdsProp !== undefined,
  });
  const linkedMachineIds = useMemo(() => {
    if (linkedMachineIdsProp !== undefined) return linkedMachineIdsProp;
    const s = new Set<string>();
    for (const ws of chatroomWorkspaces) {
      if (ws.machineId) s.add(ws.machineId);
    }
    return s;
  }, [linkedMachineIdsProp, chatroomWorkspaces]);

  const [machinePopoverOpen, setMachinePopoverOpen] = useState(false);
  const [harnessPopoverOpen, setHarnessPopoverOpen] = useState(false);
  const machineSearchState = usePickerSearchState(setMachinePopoverOpen);
  const harnessSearchState = usePickerSearchState(setHarnessPopoverOpen);

  const filteredMachines = useMemo(
    () =>
      filterPickerItems(connectedMachines, machineSearchState.searchTerm, (m) =>
        getMachineDisplayName(m)
      ),
    [connectedMachines, machineSearchState.searchTerm]
  );

  const filteredHarnesses = useMemo(
    () =>
      filterPickerItems(availableHarnessesForMachine, harnessSearchState.searchTerm, (harness) =>
        formatHarnessLabel(harness, harnessVersionsForMachine[harness])
      ),
    [availableHarnessesForMachine, harnessSearchState.searchTerm, harnessVersionsForMachine]
  );

  // Machine-level model filter for the displayed machine + harness
  const { modelFilter, isSelectedModelHidden } = useHarnessModelPicker({
    machineId: displayMachineId,
    harness: displayHarness,
    availableModels: availableModelsForHarness,
    selectedModel: displayModel,
  });
  const modelUnavailable = deriveModelUnavailable(displayMachineId, displayHarness, hasModels);

  return {
    isAgentRunning,
    display,
    favorites,
    addFavorite,
    removeFavorite,
    moveFavorite,
    isFavorite,
    recommended,
    currentEntry,
    currentEntryIsFavorite,
    handleApplyMachineConfig,
    handleDismissRecommended,
    displayHarnessVersionsForMachine,
    hasNoMachines,
    linkedMachineIds,
    machinePicker: {
      ...machineSearchState,
      open: machinePopoverOpen,
      setOpen: setMachinePopoverOpen,
    },
    harnessPicker: {
      ...harnessSearchState,
      open: harnessPopoverOpen,
      setOpen: setHarnessPopoverOpen,
    },
    filteredMachines,
    filteredHarnesses,
    modelFilter,
    isSelectedModelHidden,
    modelUnavailable,
  };
}

export type RemoteTabModel = ReturnType<typeof useRemoteTabModel>;
