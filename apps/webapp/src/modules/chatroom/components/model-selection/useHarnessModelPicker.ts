'use client';

import { useMemo } from 'react';

import { groupFlatModels } from './modelGroups';
import { normalizePickerModelIds } from './normalizePickerModelIds';
import type { ModelGroup } from './types';
import { useMachineModelFilter } from './useMachineModelFilter';
import type { UseMachineModelFilterResult } from './useMachineModelFilter';

export interface UseHarnessModelPickerParams {
  machineId: string | null | undefined;
  harness: string | null | undefined;
  availableModels: string[];
  selectedModel?: string | null;
}

export interface UseHarnessModelPickerResult {
  modelFilter: UseMachineModelFilterResult;
  visibleModels: string[];
  modelGroups: ModelGroup[];
  isSelectedModelHidden: boolean;
}

export function useHarnessModelPicker({
  machineId,
  harness,
  availableModels,
  selectedModel,
}: UseHarnessModelPickerParams): UseHarnessModelPickerResult {
  const modelFilter = useMachineModelFilter(machineId, harness);

  const normalizedModels = useMemo(() => normalizePickerModelIds(availableModels), [availableModels]);
  const visibleModels = useMemo(() => normalizedModels.filter((m) => !modelFilter.isHidden(m)), [normalizedModels, modelFilter.isHidden]);

  const modelGroups = useMemo(() => groupFlatModels(visibleModels), [visibleModels]);

  const isSelectedModelHidden = useMemo(
    () =>
      !!(
        selectedModel &&
        normalizedModels.includes(selectedModel) &&
        modelFilter.isHidden(selectedModel)
      ),
    [selectedModel, normalizedModels, modelFilter.isHidden]
  );

  return {
    modelFilter,
    visibleModels,
    modelGroups,
    isSelectedModelHidden,
  };
}
