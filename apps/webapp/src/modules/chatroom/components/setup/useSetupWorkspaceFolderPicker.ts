'use client';

import { useCallback, useState } from 'react';

import type { FolderPickerState } from './SetupFolderPickerField';
import { getMachineDisplayName } from '../../types/machine';

import { useRemoteFolderBrowser } from '@/hooks/useRemoteFolderBrowser';
import { getErrorMessage } from '@/lib/convexError';

interface UseSetupWorkspaceFolderPickerOptions {
  selectedMachineId: string | null;
  selectedMachine: { hostname: string; alias?: string } | null;
  onPathSelected: (path: string) => void;
}

/**
 * Browse state for a folder path field. It owns the one remote browser session for the field;
 * the error lives here, so callers keep none of their own.
 */
export function useSetupWorkspaceFolderPicker({
  selectedMachineId,
  selectedMachine,
  onPathSelected,
}: UseSetupWorkspaceFolderPickerOptions) {
  const [error, setError] = useState<string | null>(null);
  const machineDisplayName = selectedMachine ? getMachineDisplayName(selectedMachine) : null;

  const handleSelected = useCallback(
    (path: string) => {
      setError(null);
      onPathSelected(path);
    },
    [onPathSelected]
  );

  const { browser, open, close } = useRemoteFolderBrowser({
    machineId: selectedMachineId,
    machineDisplayName,
    onSelected: handleSelected,
  });

  const onBrowse = useCallback(
    (startPath: string) => {
      setError(null);
      open(startPath).catch((err: unknown) =>
        setError(getErrorMessage(err, 'Failed to browse folder'))
      );
    },
    [open]
  );

  const onCloseBrowser = useCallback(() => {
    close();
    setError(null);
  }, [close]);

  const reset = useCallback(() => {
    close();
    setError(null);
  }, [close]);

  const picker: FolderPickerState = {
    browser,
    machineDisplayName,
    error,
    onBrowse,
    onCloseBrowser,
  };

  return { picker, reset };
}
