'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

import { pendingOptimisticNewFilePaths } from './pendingOptimisticNewFilePaths';
import type { UseFileTabsReturn } from './useFileTabs';

/** Optimistic new-file create: track pending paths and wire explorer panel callbacks. */
export function useExplorerNewFileOps(fileTabs: UseFileTabsReturn) {
  const onFileCreated = useCallback(
    (path: string) => {
      pendingOptimisticNewFilePaths.add(path);
      fileTabs.pinTab(path);
    },
    [fileTabs]
  );

  const onFileCreateFailed = useCallback(
    (path: string, error: string) => {
      pendingOptimisticNewFilePaths.delete(path);
      fileTabs.closeTab(path);
      toast.error(`Failed to create ${path}: ${error}`);
    },
    [fileTabs]
  );

  const onFileCreateConfirmed = useCallback((path: string) => {
    pendingOptimisticNewFilePaths.delete(path);
  }, []);

  const onFileDeleted = useCallback(
    (path: string) => {
      fileTabs.closeTab(path);
    },
    [fileTabs]
  );

  return {
    onFileCreated,
    onFileCreateFailed,
    onFileCreateConfirmed,
    onFileDeleted,
  };
}
