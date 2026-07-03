'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

import { pendingOptimisticDeletePaths } from './pendingOptimisticDeletePaths';
import { pendingOptimisticNewFilePaths } from './pendingOptimisticNewFilePaths';
import type { UseFileTabsReturn } from './useFileTabs';

/** Optimistic explorer file ops: track pending paths and wire panel callbacks. */
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

  const onFileDeleteSubmitted = useCallback(
    (path: string) => {
      pendingOptimisticDeletePaths.add(path);
      const tabsToClose = fileTabs.tabs
        .filter((tab) => tab.filePath === path || (path && tab.filePath.startsWith(`${path}/`)))
        .map((tab) => tab.filePath);
      for (const tabPath of tabsToClose) {
        fileTabs.closeTab(tabPath);
      }
    },
    [fileTabs]
  );

  const onFileDeleteConfirmed = useCallback((path: string) => {
    pendingOptimisticDeletePaths.delete(path);
  }, []);

  const onFileDeleteFailed = useCallback((path: string, error: string) => {
    pendingOptimisticDeletePaths.delete(path);
    toast.error(`Failed to delete ${path}: ${error}`);
  }, []);

  return {
    onFileCreated,
    onFileCreateFailed,
    onFileCreateConfirmed,
    onFileDeleteSubmitted,
    onFileDeleteConfirmed,
    onFileDeleteFailed,
  };
}
