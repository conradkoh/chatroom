'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import { useMachineModels } from '@/hooks/useMachineModels';
import { HarnessHarnessSelect } from '@/modules/chatroom/direct-harness/components/harness-selectors/HarnessHarnessSelect';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import {
  ModelSelect,
  ModelFilterButton,
  groupFlatModels,
  useMachineModelFilter,
} from '@/modules/chatroom/components/model-selection';
import { getHarnessDisplayName } from '../../../types/machine';
import type { AgentHarness } from '../../../types/machine';

interface EnhancerHarnessModelSelectProps {
  machineId: string | null | undefined;
  agentHarness: AgentHarness | null;
  model: string | null;
  onHarnessChange: (harness: AgentHarness) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
}

export function EnhancerHarnessModelSelect({
  machineId,
  agentHarness,
  model,
  onHarnessChange,
  onModelChange,
  disabled,
}: EnhancerHarnessModelSelectProps) {
  const machinesResult = useSessionQuery(api.machines.listMachines, {});
  const machines = machinesResult?.machines ?? [];
  const machine = useMemo(() => {
    if (!machineId) return null;
    return machines.find((m: { machineId: string }) => m.machineId === machineId) ?? null;
  }, [machineId, machines]);

  const availableHarnesses: AgentHarness[] = useMemo(
    () => machine?.availableHarnesses ?? [],
    [machine]
  );

  const modelFilter = useMachineModelFilter(machineId, agentHarness);
  const { availableModels } = useMachineModels(machineId ?? undefined);
  const availableModelsForHarness = useMemo(
    () => (agentHarness ? (availableModels[agentHarness] ?? []) : []),
    [availableModels, agentHarness]
  );
  const visibleModels = useMemo(
    () => availableModelsForHarness.filter((m) => !modelFilter.isHidden(m)),
    [availableModelsForHarness, modelFilter.isHidden]
  );
  const modelGroups = useMemo(() => groupFlatModels(visibleModels), [visibleModels]);

  const harnessOptions: HarnessOption[] = useMemo(
    () =>
      availableHarnesses.map((h) => ({
        name: h,
        displayName: getHarnessDisplayName(h),
        agents: [],
        providers: [],
      })),
    [availableHarnesses]
  );

  const handleHarnessChange = useCallback(
    (name: string) => {
      onHarnessChange(name as AgentHarness);
      onModelChange('');
    },
    [onHarnessChange, onModelChange]
  );

  if (!machineId) {
    return (
      <p className="text-xs text-chatroom-text-muted">
        Select a workspace with a connected machine to choose a model.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block text-xs font-medium text-chatroom-text-secondary mb-1">
          Agent harness
        </label>
        <HarnessHarnessSelect
          harnesses={harnessOptions}
          value={agentHarness ?? ''}
          onValueChange={handleHarnessChange}
          disabled={disabled || harnessOptions.length === 0}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-chatroom-text-secondary mb-1">Model</label>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ModelSelect
              groups={modelGroups}
              value={model ?? ''}
              onValueChange={onModelChange}
              isHidden={modelFilter.isHidden}
              disabled={disabled || !agentHarness}
              triggerVariant="chatroom"
              allowDeselect={false}
              placeholder={!agentHarness ? 'Select a harness first' : 'Select a model'}
              filter={modelFilter.filter}
            />
          </div>
          {agentHarness && (
            <ModelFilterButton
              filter={modelFilter}
              availableModels={availableModelsForHarness}
              disabled={disabled}
              variant="chatroom"
            />
          )}
        </div>
      </div>
    </div>
  );
}
