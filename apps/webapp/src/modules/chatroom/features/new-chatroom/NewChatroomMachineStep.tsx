'use client';

import { SetupMachineSection } from '../../components/setup/SetupMachineSection';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
  setupSecondaryButtonClassName,
} from '../../components/setup/SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from '../../components/setup/SetupWorkspaceLoadingPanel';
import type { UserMachine } from '../../types/machine';

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

/** Mounted only after machines load, so the focus effect runs against the rendered controls. */
function MachineStepContent({
  machines,
  connectedMachineIds,
  selectedMachineId,
  onSelectMachine,
  onContinue,
  onCancel,
}: MachineStepContentProps) {
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
      <SetupMachineSection
        machines={machines}
        connectedMachineIds={connectedMachineIds}
        selectedMachineId={selectedMachineId}
        onSelectMachine={onSelectMachine}
        detectedHarnesses={[]}
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
