'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useMachineModels } from '@/hooks/useMachineModels';
import { getHarnessDisplayName, getModelDisplayLabel } from '../../../types/machine';
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

  const { availableModels } = useMachineModels(machineId ?? undefined);
  const availableModelsForHarness = useMemo(
    () => (agentHarness ? (availableModels[agentHarness] ?? []) : []),
    [availableModels, agentHarness]
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
        <select
          value={agentHarness ?? ''}
          onChange={(e) => {
            onHarnessChange(e.target.value as AgentHarness);
            onModelChange('');
          }}
          disabled={disabled || availableHarnesses.length === 0}
          className="w-full border-2 border-chatroom-border bg-chatroom-bg-primary text-sm text-chatroom-text-primary px-2 py-1.5 rounded-none focus:outline-none focus:border-chatroom-accent disabled:opacity-40"
        >
          <option value="" disabled>
            {availableHarnesses.length === 0 ? 'No harnesses available' : 'Select a harness'}
          </option>
          {availableHarnesses.map((h) => (
            <option key={h} value={h}>
              {getHarnessDisplayName(h)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-chatroom-text-secondary mb-1">Model</label>
        <select
          value={model ?? ''}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled || !agentHarness || availableModelsForHarness.length === 0}
          className="w-full border-2 border-chatroom-border bg-chatroom-bg-primary text-sm text-chatroom-text-primary px-2 py-1.5 rounded-none focus:outline-none focus:border-chatroom-accent disabled:opacity-40"
        >
          <option value="" disabled>
            {!agentHarness
              ? 'Select a harness first'
              : availableModelsForHarness.length === 0
                ? 'No models available'
                : 'Select a model'}
          </option>
          {availableModelsForHarness.map((m) => (
            <option key={m} value={m}>
              {getModelDisplayLabel(m)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
