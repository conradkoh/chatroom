'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { SetupFolderPickerField } from './SetupFolderPickerField';
import { SetupMachinePicker } from './SetupMachinePicker';
import { SetupWorkspaceConfirmButton } from './SetupWorkspaceConfirmButton';
import { SetupWorkspaceLoadingPanel } from './SetupWorkspaceLoadingPanel';
import { SetupWorkspacePrerequisitesPanel } from './SetupWorkspacePrerequisitesPanel';
import { useSetupWorkspaceFolderPicker } from './useSetupWorkspaceFolderPicker';
import type { MachineInfo } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

import { getAuthLoginCommand, getDaemonStartCommand } from '@/lib/environment';

interface SetupWorkspaceStepProps {
  connectedMachines: MachineInfo[];
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
  const [error, setError] = useState<string | null>(null);

  const daemonStartCommand = getDaemonStartCommand();
  const authLoginCommand = getAuthLoginCommand(
    typeof window !== 'undefined' ? window.location.origin : ''
  );

  const detectedHarnesses = useMemo(() => {
    const all = connectedMachines.flatMap((m) => m.availableHarnesses);
    return [...new Set(all)];
  }, [connectedMachines]);

  const harnessDone = detectedHarnesses.length > 0;
  const daemonDone = connectedMachines.length > 0;

  const selectedMachine = useMemo(
    () => connectedMachines.find((m) => m.machineId === selectedMachineId) ?? null,
    [connectedMachines, selectedMachineId]
  );

  const {
    requestId,
    isPending,
    isTimedOut,
    handleBrowse,
    handleRetryAfterTimeout,
    reset: resetFolderPicker,
    machineDisplayName,
  } = useSetupWorkspaceFolderPicker({
    selectedMachineId,
    selectedMachine,
    onPathSelected: setSelectedPath,
    setError,
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
      setError(null);
      resetFolderPicker();
    },
    [resetFolderPicker]
  );

  const handleConfirm = useCallback(async () => {
    const path = selectedPath.trim();
    if (!selectedMachineId || !path) {
      setError('Select a machine and workspace folder');
      return;
    }
    setIsConfirming(true);
    setError(null);
    try {
      await onConfirm(selectedMachineId, path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsConfirming(false);
    }
  }, [onConfirm, selectedMachineId, selectedPath]);

  if (isLoadingMachines) {
    return <SetupWorkspaceLoadingPanel />;
  }

  if (connectedMachines.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <SetupWorkspacePrerequisitesPanel
          daemonDone={false}
          harnessDone={false}
          detectedHarnesses={[]}
          authLoginCommand={authLoginCommand}
          daemonStartCommand={daemonStartCommand}
        />
      </div>
    );
  }

  const folderPlaceholder = selectedMachine
    ? `Select a folder on ${getMachineDisplayName(selectedMachine)}`
    : 'Select a machine first';

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
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
        selectedPath={selectedPath}
        onPathChange={setSelectedPath}
        placeholder={folderPlaceholder}
        disabled={!selectedMachineId}
        isPending={isPending}
        isConfirming={isConfirming}
        isTimedOut={isTimedOut}
        requestId={requestId}
        machineDisplayName={machineDisplayName}
        onBrowse={() => void handleBrowse()}
        onRetryAfterTimeout={handleRetryAfterTimeout}
      />

      {error && <p className="text-xs text-chatroom-status-error">{error}</p>}

      <SetupWorkspaceConfirmButton
        disabled={!selectedMachineId || !selectedPath.trim() || isConfirming || isPending}
        isConfirming={isConfirming}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  );
});
