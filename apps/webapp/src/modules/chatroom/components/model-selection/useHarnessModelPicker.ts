'use client';

import { useMemo } from 'react';

import { groupFlatModels } from './modelGroups';
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

  const visibleModels = useMemo(
    () => availableModels.filter((m) => !modelFilter.isHidden(m)),
    [availableModels, modelFilter.isHidden]
  );

  const modelGroups = useMemo(() => groupFlatModels(visibleModels), [visibleModels]);

  const isSelectedModelHidden = useMemo(
    () =>
      !!(
        selectedModel &&
        availableModels.includes(selectedModel) &&
        modelFilter.isHidden(selectedModel)
      ),
    [selectedModel, availableModels, modelFilter.isHidden]
  );

  return {
    modelFilter,
    visibleModels,
    modelGroups,
    isSelectedModelHidden,
  };
}
