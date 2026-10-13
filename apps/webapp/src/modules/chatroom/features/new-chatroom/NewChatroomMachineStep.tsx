'use client';

import { useMemo, useRef } from 'react';

import { useFocusFirstControl } from './useFocusFirstControl';
import { SetupMachinePicker } from '../../components/setup/SetupMachinePicker';
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

/** Cancel always, Continue once a connected machine exists. */
function MachineStepActions({
  hasConnectedMachine,
  canContinue,
  onCancel,
  onContinue,
}: {
  hasConnectedMachine: boolean;
  canContinue: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="px-4 py-2 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover"
      >
        Cancel
      </button>
      {hasConnectedMachine && (
        <button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="px-4 py-2 bg-chatroom-status-success text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
        >
          Continue
        </button>
      )}
    </div>
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
  const containerRef = useRef<HTMLDivElement>(null);
  useFocusFirstControl(containerRef);

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
    <div ref={containerRef} className="flex flex-col gap-6 min-h-[18rem]">
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

      <MachineStepActions
        hasConnectedMachine={hasConnectedMachine}
        canContinue={canContinue}
        onCancel={onCancel}
        onContinue={onContinue}
      />
    </div>
  );
}

/** Step 1: choose a connected machine. Offline machines are listed but cannot be selected. */
export function NewChatroomMachineStep({ isLoading, ...props }: NewChatroomMachineStepProps) {
  if (isLoading) {
    return <SetupWorkspaceLoadingPanel />;
  }
  return <MachineStepContent {...props} />;
}
