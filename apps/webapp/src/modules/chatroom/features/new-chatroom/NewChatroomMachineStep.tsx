'use client';

import { useMemo } from 'react';

import { SetupMachinePicker } from '../../components/setup/SetupMachinePicker';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
  setupSecondaryButtonClassName,
} from '../../components/setup/SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from '../../components/setup/SetupWorkspaceLoadingPanel';
import { SetupWorkspacePrerequisitesPanel } from '../../components/setup/SetupWorkspacePrerequisitesPanel';
import type { UserMachine } from '../../types/machine';

import { getAuthLoginCommand, getDaemonStartCommand } from '@/lib/environment';

interface NewChatroomMachineStepProps {
  machines: UserMachine[];
  /** Machines whose daemon is connected. Only these can be selected. */
  connectedMachineIds: ReadonlySet<string>;
  isLoading: boolean;
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}

type MachineStepContentProps = Omit<NewChatroomMachineStepProps, 'isLoading'>;

function loginCommandForThisOrigin(): string {
  return getAuthLoginCommand(typeof window !== 'undefined' ? window.location.origin : '');
}

/** The machine list, or guidance when no machine is registered yet. */
function MachineListOrEmpty({
  machines,
  selectedMachineId,
  onSelectMachine,
  offlineMachineIds,
}: {
  machines: UserMachine[];
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  offlineMachineIds: ReadonlySet<string>;
}) {
  if (machines.length === 0) {
    return (
      <p className="text-xs text-chatroom-text-muted">
        No machines are registered yet. Start the daemon on a machine to see it here.
      </p>
    );
  }
  return (
    <SetupMachinePicker
      machines={machines}
      selectedMachineId={selectedMachineId}
      onSelectMachine={onSelectMachine}
      disabledMachineIds={offlineMachineIds}
    />
  );
}

/** Mounted only after machines load, so the focus effect runs against the rendered controls. */
function MachineStepContent({
  machines,
  connectedMachineIds,
  selectedMachineId,
  onSelectMachine,
  onContinue,
  onCancel,
}: MachineStepContentProps) {
  const offlineMachineIds = useMemo(
    () =>
      new Set(
        machines.filter((m) => !connectedMachineIds.has(m.machineId)).map((m) => m.machineId)
      ),
    [machines, connectedMachineIds]
  );

  const hasConnectedMachine = connectedMachineIds.size > 0;
  const canContinue = selectedMachineId !== null && connectedMachineIds.has(selectedMachineId);

  return (
    <SetupStepLayout
      autoFocusFirstControl={true}
      footer={
        <SetupStepFooter
          secondary={
            <button type="button" onClick={onCancel} className={setupSecondaryButtonClassName}>
              Cancel
            </button>
          }
          primary={
            hasConnectedMachine ? (
              <button
                type="button"
                onClick={onContinue}
                disabled={!canContinue}
                className={setupPrimaryButtonClassName}
              >
                Continue
              </button>
            ) : undefined
          }
        />
      }
    >
      {!hasConnectedMachine && (
        <SetupWorkspacePrerequisitesPanel
          daemonDone={false}
          harnessDone={false}
          detectedHarnesses={[]}
          authLoginCommand={loginCommandForThisOrigin()}
          daemonStartCommand={getDaemonStartCommand()}
        />
      )}

      <MachineListOrEmpty
        machines={machines}
        selectedMachineId={selectedMachineId}
        onSelectMachine={onSelectMachine}
        offlineMachineIds={offlineMachineIds}
      />
    </SetupStepLayout>
  );
}

/** Step 1: choose a connected machine. Offline machines are listed but cannot be selected. */
export function NewChatroomMachineStep({ isLoading, ...props }: NewChatroomMachineStepProps) {
  if (isLoading) {
    return <SetupWorkspaceLoadingPanel />;
  }
  return <MachineStepContent {...props} />;
}
