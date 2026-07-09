'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  getTrackedFileEntries,
  subscribeTrackedWorkspace,
  toTrackedWorkspaceKey,
} from './trackedWorkspaceFilesStore';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const EMPTY: FileEntry[] = [];

export function useTrackedWorkspaceFiles(
  machineId: string,
  workingDir: string,
  enabled = true
): FileEntry[] {
  const workspaceKey = useMemo(
    () => (enabled && machineId && workingDir ? toTrackedWorkspaceKey(machineId, workingDir) : ''),
    [enabled, machineId, workingDir]
  );

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!workspaceKey) return () => {};
      return subscribeTrackedWorkspace(workspaceKey, onStoreChange);
    },
    [workspaceKey]
  );

  const getSnapshot = useCallback(() => {
    if (!workspaceKey) return EMPTY;
    return getTrackedFileEntries(workspaceKey);
  }, [workspaceKey]);

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
