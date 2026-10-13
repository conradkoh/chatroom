'use client';

import { useCallback, useEffect, useState } from 'react';

import type { FolderPickerState } from './SetupFolderPickerField';
import { getMachineDisplayName } from '../../types/machine';

import { useFolderPicker } from '@/hooks/useFolderPicker';

type FolderPickerRequest = NonNullable<ReturnType<typeof useFolderPicker>['request']>;

interface UseSetupWorkspaceFolderPickerOptions {
  selectedMachineId: string | null;
  selectedMachine: { hostname: string; alias?: string } | null;
  onPathSelected: (path: string) => void;
}

function applyFolderPickerRequestResult(
  request: FolderPickerRequest,
  onPathSelected: (path: string) => void,
  setError: (error: string | null) => void,
  resetPicker: () => void
): void {
  if (request.status === 'pending') return;
  if (request.status === 'completed' && request.selectedPath) {
    onPathSelected(request.selectedPath);
    setError(null);
    resetPicker();
    return;
  }
  if (request.status === 'cancelled') {
    setError(null);
    resetPicker();
    return;
  }
  if (request.status === 'failed') {
    setError(request.errorMessage ?? 'Folder picker failed');
    resetPicker();
  }
}

/** Browse state for a folder path field. The error lives here, so callers keep none of their own. */
export function useSetupWorkspaceFolderPicker({
  selectedMachineId,
  selectedMachine,
  onPathSelected,
}: UseSetupWorkspaceFolderPickerOptions) {
  const {
    pickFolder,
    request,
    requestId,
    reset: resetPicker,
    isPending,
    isTimedOut,
  } = useFolderPicker();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    applyFolderPickerRequestResult(request, onPathSelected, setError, resetPicker);
  }, [request, resetPicker, onPathSelected]);

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
  }, [pickFolder, selectedMachineId]);

  const handleRetryAfterTimeout = useCallback(() => {
    resetPicker();
    setError(null);
  }, [resetPicker]);

  const reset = useCallback(() => {
    resetPicker();
    setError(null);
  }, [resetPicker]);

  const onBrowse = useCallback(() => void handleBrowse(), [handleBrowse]);

  const picker: FolderPickerState = {
    isPending,
    isTimedOut,
    requestId,
    error,
    machineDisplayName: selectedMachine ? getMachineDisplayName(selectedMachine) : null,
    onBrowse,
    onRetryAfterTimeout: handleRetryAfterTimeout,
  };

  return { picker, reset };
}
