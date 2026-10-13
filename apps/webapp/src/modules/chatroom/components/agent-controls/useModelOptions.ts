'use client';

import { useMemo } from 'react';

import { deriveModelSelectionReady, deriveSelectedModel } from './derivations';
import { useMachineModels } from '../../../../hooks/useMachineModels';
import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import type { AgentConfig, AgentHarness } from '../../types/machine';
import { isModelHidden } from '../../utils/modelSelection';
import { useMachineModelFilter } from '../model-selection';

/**
 * Models for the selected machine and harness, after the machine filter. The selected model is a
 * pure derivation: no effect and no setState.
 */
export function useModelOptions({
  selectedMachineId,
  selectedHarness,
  roleConfigs,
  teamConfigModel,
  userModelByHarness,
  defaultFavorites,
}: {
  selectedMachineId: string | null;
  selectedHarness: AgentHarness | null;
  roleConfigs: AgentConfig[];
  teamConfigModel?: string;
  userModelByHarness: Partial<Record<AgentHarness, string>>;
  defaultFavorites: readonly MachineConfigEntry[];
}) {
  // Available models from the selected machine filtered by selected harness
  const { availableModels: machineModels, isLoading: machineModelsLoading } = useMachineModels(
    selectedMachineId ?? undefined
  );
  const availableModelsForHarness = useMemo(
    () => (selectedMachineId && selectedHarness ? (machineModels[selectedHarness] ?? []) : []),
    [machineModels, selectedMachineId, selectedHarness]
  );

  // Machine-level model filter — used to exclude blacklisted models from
  // automatic selection and the model combobox.
  const modelFilter = useMachineModelFilter(selectedMachineId, selectedHarness);
  const machineModelFilter = modelFilter.filter ?? null;
  const machineModelFilterLoading = modelFilter.enabled && modelFilter.filter === undefined;

  // Wait for async machine models + filter before deriving selection — avoids flashing
  // a stale model label when switching machines or harnesses.
  const modelSelectionReady = deriveModelSelectionReady({
    selectedMachineId,
    selectedHarness,
    machineModelsLoading,
    machineModelFilterLoading,
  });

  // Visible models = available models minus those hidden by the filter.
  // The combobox and automatic model selection use this list.
  const visibleModels = useMemo(
    () => availableModelsForHarness.filter((m) => !isModelHidden(m, machineModelFilter)),
    [availableModelsForHarness, machineModelFilter]
  );

  const selectedModel = useMemo(
    () =>
      deriveSelectedModel({
        modelSelectionReady,
        roleConfigs,
        selectedMachineId,
        selectedHarness,
        availableModelsForHarness,
        visibleModels,
        userModelByHarness,
        teamConfigModel,
        defaultFavorites,
      }),
    [
      modelSelectionReady,
      selectedHarness,
      availableModelsForHarness,
      visibleModels,
      userModelByHarness,
      roleConfigs,
      selectedMachineId,
      teamConfigModel,
      defaultFavorites,
    ]
  );

  return { availableModelsForHarness, visibleModels, machineModelFilter, selectedModel };
}
