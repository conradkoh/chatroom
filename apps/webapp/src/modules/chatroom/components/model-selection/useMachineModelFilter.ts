'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { isModelHidden } from '../../utils/modelSelection';

export interface MachineModelFilter {
  hiddenModels: string[];
  hiddenProviders: string[];
}

export interface UseMachineModelFilterResult {
  filter: MachineModelFilter | null | undefined;
  setFilter: (hiddenModels: string[], hiddenProviders: string[]) => Promise<void>;
  isHidden: (modelKeyOrId: string) => boolean;
  enabled: boolean;
}

type AgentHarness = 'opencode' | 'opencode-sdk' | 'pi' | 'cursor' | 'claude' | 'copilot';

export function useMachineModelFilter(
  machineId: string | null | undefined,
  harnessName: string | null | undefined
): UseMachineModelFilterResult {
  const enabled = Boolean(machineId && harnessName);

  const filterDoc = useSessionQuery(
    api.machines.getMachineModelFilters,
    enabled && machineId && harnessName
      ? { machineId, agentHarness: harnessName as AgentHarness }
      : 'skip'
  ) as MachineModelFilter | null | undefined;

  const upsertMachineModelFilters = useSessionMutation(api.machines.upsertMachineModelFilters);

  const setFilter = useCallback(
    async (hiddenModels: string[], hiddenProviders: string[]) => {
      if (!enabled || !machineId || !harnessName) return;
      await upsertMachineModelFilters({
        machineId,
        agentHarness: harnessName as AgentHarness,
        hiddenModels,
        hiddenProviders,
      });
    },
    [enabled, machineId, harnessName, upsertMachineModelFilters]
  );

  const isHidden = useCallback(
    (modelKeyOrId: string): boolean => {
      const normalized = modelKeyOrId.replace('::', '/');
      return isModelHidden(normalized, filterDoc ?? null);
    },
    [filterDoc]
  );

  return { filter: filterDoc, setFilter, isHidden, enabled };
}
