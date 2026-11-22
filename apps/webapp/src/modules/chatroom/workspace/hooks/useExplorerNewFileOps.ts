'use client';

import { useCallback } from 'react';

import { pendingOptimisticDeletePaths } from './pendingOptimisticDeletePaths';
import { pendingOptimisticNewFilePaths } from './pendingOptimisticNewFilePaths';
import type { EditorTab, UseFileTabsReturn } from './useFileTabs';

/** Optimistic explorer file ops: track pending paths and wire panel callbacks. Failures go to `onError`. */
export function useExplorerNewFileOps(
  fileTabs: UseFileTabsReturn,
  onError: (message: string) => void
) {
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
      onError(`Failed to create ${path}: ${error}`);
    },
    [fileTabs, onError]
  );

  const onFileCreateConfirmed = useCallback((path: string) => {
    pendingOptimisticNewFilePaths.delete(path);
  }, []);

  const onFileDeleteSubmitted = useCallback(
    (path: string) => {
      pendingOptimisticDeletePaths.add(path);
      type FileTab = Extract<EditorTab, { kind: 'file' }>;
      const fileTabsList = fileTabs.tabs.filter((t): t is FileTab => t.kind === 'file');
      const tabsToClose = fileTabsList
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

  const onFileDeleteFailed = useCallback(
    (path: string, error: string) => {
      pendingOptimisticDeletePaths.delete(path);
      onError(`Failed to delete ${path}: ${error}`);
    },
    [onError]
  );

  const onFileRenamed = useCallback(
    (oldPath: string, newPath: string) => {
      fileTabs.renamePath(oldPath, newPath);
    },
    [fileTabs]
  );

  const onFileRenameFailed = useCallback(
    (oldPath: string, error: string) => {
      onError(`Failed to rename ${oldPath}: ${error}`);
    },
    [onError]
  );

  const onFileRenameConfirmed = useCallback((_oldPath: string, _newPath: string) => {
    // no-op for now (mirror onFileCreateConfirmed)
  }, []);

  return {
    onFileCreated,
    onFileCreateFailed,
    onFileCreateConfirmed,
    onFileDeleteSubmitted,
    onFileDeleteConfirmed,
    onFileDeleteFailed,
    onFileRenamed,
    onFileRenameFailed,
    onFileRenameConfirmed,
  };
}
