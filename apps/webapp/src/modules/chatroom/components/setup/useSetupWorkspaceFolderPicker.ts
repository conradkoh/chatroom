'use client';

import { useCallback, useEffect } from 'react';

import type { MachineInfo } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

import { useFolderPicker } from '@/hooks/useFolderPicker';

type FolderPickerRequest = NonNullable<ReturnType<typeof useFolderPicker>['request']>;

interface UseSetupWorkspaceFolderPickerOptions {
  selectedMachineId: string | null;
  selectedMachine: MachineInfo | null;
  onPathSelected: (path: string) => void;
  setError: (error: string | null) => void;
}

function applyFolderPickerRequestResult(
  request: FolderPickerRequest,
  onPathSelected: (path: string) => void,
  setError: (error: string | null) => void,
  reset: () => void
): void {
  if (request.status === 'pending') return;
  if (request.status === 'completed' && request.selectedPath) {
    onPathSelected(request.selectedPath);
    setError(null);
    reset();
    return;
  }
  if (request.status === 'cancelled') {
    setError(null);
    reset();
    return;
  }
  if (request.status === 'failed') {
    setError(request.errorMessage ?? 'Folder picker failed');
    reset();
  }
}

export function useSetupWorkspaceFolderPicker({
  selectedMachineId,
  selectedMachine,
  onPathSelected,
  setError,
}: UseSetupWorkspaceFolderPickerOptions) {
  const { pickFolder, request, requestId, reset, isPending, isTimedOut } = useFolderPicker();

  useEffect(() => {
    if (!request) return;
    applyFolderPickerRequestResult(request, onPathSelected, setError, reset);
  }, [request, reset, onPathSelected, setError]);

  useEffect(() => {
    if (isTimedOut) {
      setError('Folder picker timed out. Ensure the daemon is running on the selected machine.');
    }
  }, [isTimedOut, setError]);

  const handleBrowse = useCallback(async () => {
    if (!selectedMachineId) {
      setError('Select a machine first');
      return;
    }
    setError(null);
    try {
      await pickFolder(selectedMachineId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open folder picker');
    }
  }, [pickFolder, selectedMachineId, setError]);

  const handleRetryAfterTimeout = useCallback(() => {
    reset();
    setError(null);
  }, [reset, setError]);

  return {
    requestId,
    isPending,
    isTimedOut,
    handleBrowse,
    handleRetryAfterTimeout,
    reset,
    machineDisplayName: selectedMachine ? getMachineDisplayName(selectedMachine) : null,
  };
}
