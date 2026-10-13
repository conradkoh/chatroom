'use client';

import { memo, useCallback, useMemo, useState } from 'react';

import { pickDefaultMachineId } from './pickDefaultMachineId';
import { SetupFolderPickerField } from './SetupFolderPickerField';
import { SetupMachineSection } from './SetupMachineSection';
import { SetupStepFooter, SetupStepLayout, setupPrimaryButtonClassName } from './SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from './SetupWorkspaceLoadingPanel';
import { SetupWorkspacePrerequisitesPanel } from './SetupWorkspacePrerequisitesPanel';
import { useSetupWorkspaceFolderPicker } from './useSetupWorkspaceFolderPicker';
import type { UserMachine } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

import { useMachineCapabilities } from '@/hooks/useMachineCapabilities';
import { getAuthLoginCommandForCurrentOrigin, getDaemonStartCommand } from '@/lib/environment';

interface SetupWorkspaceStepProps {
  connectedMachines: UserMachine[];
  isLoadingMachines: boolean;
  onConfirm: (machineId: string, workingDir: string) => Promise<void>;
}

export const SetupWorkspaceStep = memo(function SetupWorkspaceStep({
  connectedMachines,
  isLoadingMachines,
  onConfirm,
}: SetupWorkspaceStepProps) {
  const [chosenMachineId, setChosenMachineId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const daemonStartCommand = getDaemonStartCommand();
  const authLoginCommand = getAuthLoginCommandForCurrentOrigin();

  // A single connected machine is selected by default. Once a machine is chosen, by the user or by
  // this default, it stays chosen, so a second machine connecting later does not clear it. The
  // default is latched during render rather than in an effect.
  const defaultMachineId = pickDefaultMachineId(connectedMachines, chosenMachineId);
  if (chosenMachineId === null && defaultMachineId !== null) {
    setChosenMachineId(defaultMachineId);
  }
  const selectedMachineId = chosenMachineId ?? defaultMachineId;
  const connectedMachineIds = useMemo(
    () => new Set(connectedMachines.map((m) => m.machineId)),
    [connectedMachines]
  );

  const selectedMachine = useMemo(
    () => connectedMachines.find((m) => m.machineId === selectedMachineId) ?? null,
    [connectedMachines, selectedMachineId]
  );
  const { availableHarnesses } = useMachineCapabilities(selectedMachine?.machineId ?? null);
  const detectedHarnesses = availableHarnesses;

  const harnessDone = detectedHarnesses.length > 0;
  const daemonDone = connectedMachines.length > 0;

  const { picker, reset: resetFolderPicker } = useSetupWorkspaceFolderPicker({
    selectedMachineId,
    selectedMachine,
    onPathSelected: setSelectedPath,
  });

  const handleSelectMachine = useCallback(
    (machineId: string) => {
      setChosenMachineId(machineId);
      setSelectedPath('');
      setConfirmError(null);
      resetFolderPicker();
    },
    [resetFolderPicker]
  );

  const handleConfirm = useCallback(async () => {
    const path = selectedPath.trim();
    if (!selectedMachineId || !path) {
      setConfirmError('Select a machine and workspace folder');
      return;
    }
    setIsConfirming(true);
    setConfirmError(null);
    try {
      await onConfirm(selectedMachineId, path);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsConfirming(false);
    }
  }, [onConfirm, selectedMachineId, selectedPath]);

  if (isLoadingMachines) {
    return <SetupWorkspaceLoadingPanel />;
  }

  if (connectedMachines.length === 0) {
    return (
      <SetupStepLayout autoFocusFirstControl={false}>
        <SetupWorkspacePrerequisitesPanel
          daemonDone={false}
          harnessDone={false}
          detectedHarnesses={[]}
          authLoginCommand={authLoginCommand}
          daemonStartCommand={daemonStartCommand}
        />
      </SetupStepLayout>
    );
  }

  const folderPlaceholder = selectedMachine
    ? `Select a folder on ${getMachineDisplayName(selectedMachine)}`
    : 'Select a machine first';

  const confirmDisabled =
    !selectedMachineId || !selectedPath.trim() || isConfirming || picker.isPending;

  return (
    <SetupStepLayout
      autoFocusFirstControl={false}
      footer={
        <SetupStepFooter
          primary={
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirmDisabled}
              className={setupPrimaryButtonClassName}
            >
              {isConfirming ? 'Creating...' : 'Confirm Workspace'}
            </button>
          }
        />
      }
    >
      <SetupWorkspacePrerequisitesPanel
        daemonDone={daemonDone}
        harnessDone={harnessDone}
        detectedHarnesses={detectedHarnesses}
      />

      <SetupMachineSection
        machines={connectedMachines}
        connectedMachineIds={connectedMachineIds}
        selectedMachineId={selectedMachineId}
        onSelectMachine={handleSelectMachine}
        detectedHarnesses={detectedHarnesses}
      />

      <SetupFolderPickerField
        variant="setup"
        heading="Workspace Folder"
        inputAriaLabel="Workspace Folder"
        waitingText={`Waiting for folder selection on ${picker.machineDisplayName ?? 'machine'}...`}
        value={selectedPath}
        onChange={setSelectedPath}
        placeholder={folderPlaceholder}
        inputDisabled={!selectedMachineId || picker.isPending}
        browseDisabled={!selectedMachineId || isConfirming}
        picker={picker}
      />

      {confirmError && <p className="text-xs text-chatroom-status-error">{confirmError}</p>}
    </SetupStepLayout>
  );
});
