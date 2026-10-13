'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { SetupFolderPickerField } from './SetupFolderPickerField';
import { SetupMachinePicker } from './SetupMachinePicker';
import { SetupStepFooter, SetupStepLayout, setupPrimaryButtonClassName } from './SetupStepLayout';
import { SetupWorkspaceLoadingPanel } from './SetupWorkspaceLoadingPanel';
import { SetupWorkspacePrerequisitesPanel } from './SetupWorkspacePrerequisitesPanel';
import { useSetupWorkspaceFolderPicker } from './useSetupWorkspaceFolderPicker';
import type { UserMachine } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

import { useMachineCapabilities } from '@/hooks/useMachineCapabilities';
import { getAuthLoginCommand, getDaemonStartCommand } from '@/lib/environment';

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
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const daemonStartCommand = getDaemonStartCommand();
  const authLoginCommand = getAuthLoginCommand(
    typeof window !== 'undefined' ? window.location.origin : ''
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

  useEffect(() => {
    if (connectedMachines.length === 1 && !selectedMachineId) {
      setSelectedMachineId(connectedMachines[0].machineId);
    }
  }, [connectedMachines, selectedMachineId]);

  const handleSelectMachine = useCallback(
    (machineId: string) => {
      setSelectedMachineId(machineId);
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

      <SetupMachinePicker
        machines={connectedMachines}
        selectedMachineId={selectedMachineId}
        onSelectMachine={handleSelectMachine}
      />

      <SetupFolderPickerField
        label="Workspace Folder"
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
