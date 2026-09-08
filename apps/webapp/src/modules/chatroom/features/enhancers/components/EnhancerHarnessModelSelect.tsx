'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

import { MachineCapabilitiesRefreshButton } from '../../../components/MachineCapabilitiesRefreshButton';
import { formatHarnessLabel } from '../../../types/machine';
import type { AgentHarness } from '../../../types/machine';
import { useChatroomWorkspaces } from '../../../workspace/hooks/useChatroomWorkspaces';

import { useDaemonConnected } from '@/hooks/useDaemonConnected';
import { useMachineModels } from '@/hooks/useMachineModels';
import { ModelPickerField } from '@/modules/chatroom/components/model-selection';
import { HarnessHarnessSelect } from '@/modules/chatroom/direct-harness/components/harness-selectors/HarnessHarnessSelect';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';

interface EnhancerHarnessModelSelectProps {
  chatroomId: string;
  machineId: string | null | undefined;
  agentHarness: AgentHarness | null;
  model: string | null;
  onHarnessChange: (harness: AgentHarness) => void;
  onModelChange: (model: string) => void;
  disabled?: boolean;
}

export function EnhancerHarnessModelSelect({
  chatroomId,
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

  const harnessOptions: HarnessOption[] = useMemo(
    () =>
      availableHarnesses.map((h) => {
        const version = machine?.harnessVersions?.[h];
        return {
          name: h,
          displayName: formatHarnessLabel(h, version),
          version,
          agents: [],
          providers: [],
        };
      }),
    [availableHarnesses, machine?.harnessVersions]
  );

  const handleHarnessChange = useCallback(
    (name: string) => {
      onHarnessChange(name as AgentHarness);
      onModelChange('');
    },
    [onHarnessChange, onModelChange]
  );

  const { isConnected: daemonConnected } = useDaemonConnected(machineId ?? null);
  const { workspaces } = useChatroomWorkspaces(chatroomId);
  const linkedToChatroom = Boolean(
    machineId && workspaces.some((workspace) => workspace.machineId === machineId)
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
        <div className="flex items-stretch gap-1">
          <div className="min-w-0 flex-1">
            <HarnessHarnessSelect
              harnesses={harnessOptions}
              value={agentHarness ?? ''}
              onValueChange={handleHarnessChange}
              disabled={disabled || harnessOptions.length === 0}
            />
          </div>
          <MachineCapabilitiesRefreshButton
            chatroomId={chatroomId}
            machineId={machineId}
            daemonConnected={daemonConnected}
            linkedToChatroom={linkedToChatroom}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-chatroom-text-secondary mb-1">Model</label>
        <ModelPickerField
          machineId={machineId}
          harness={agentHarness}
          availableModels={availableModelsForHarness}
          value={model ?? ''}
          onValueChange={onModelChange}
          disabled={disabled}
          triggerVariant="chatroom"
          allowDeselect={false}
        />
      </div>
    </div>
  );
}
