'use client';
// fallow-ignore-file code-duplication complexity

import type { FileTreeEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { fileTreeEntriesToFileEntries } from './fileTreeUtils';
import { useRequestWorkspaceFileTree } from './useRequestWorkspaceFileTree';
import { useWorkspaceFileTreeDeltaSync } from './useWorkspaceFileTreeDeltaSync';
import { requestWorkspaceFileTreeRefresh } from './workspaceFileTreeRefreshCoordinator';
import { useWorkspaceFileTreeStoreRevision } from '../hooks/useWorkspaceFileTreeStoreRevision';
import {
  getWorkspaceFileTreeEntries,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
} from '../stores/workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const EMPTY_ENTRIES: FileEntry[] = [];

export interface UseWorkspaceFileTreeEntriesArgs {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  includeDirectories?: boolean;
}

export interface UseWorkspaceFileTreeEntriesResult {
  entries: FileEntry[];
  /** Raw store entries (includes directories) — for explorer tree building */
  treeEntries: FileTreeEntry[];
  isLoading: boolean;
  hasTree: boolean;
  refresh: (options?: { force?: boolean }) => void;
}

export function useWorkspaceFileTreeEntries({
  machineId,
  workingDir,
  enabled = true,
  includeDirectories = false,
}: UseWorkspaceFileTreeEntriesArgs): UseWorkspaceFileTreeEntriesResult {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const workspaceKey = toWorkspaceFileTreeKey(machineId, normalizedWorkingDir);

  const requestTree = useRequestWorkspaceFileTree({
    machineId,
    workingDir: normalizedWorkingDir,
    enabled,
  });

  useWorkspaceFileTreeDeltaSync({
    workspaceKey,
    machineId,
    workingDir: normalizedWorkingDir,
    enabled,
  });

  const storeEntries = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeEntries(workspaceKey),
    () => getWorkspaceFileTreeEntries(workspaceKey)
  );
  const storeRevision = useWorkspaceFileTreeStoreRevision(workspaceKey);

  const entries = useMemo(() => {
    if (!enabled) return EMPTY_ENTRIES;
    const converted = fileTreeEntriesToFileEntries(storeEntries);
    if (includeDirectories) return converted;
    return converted.filter((entry) => entry.type === 'file');
  }, [enabled, includeDirectories, storeEntries]);

  const hasTree = enabled && (storeEntries.length > 0 || storeRevision !== null);
  const isLoading = enabled && !hasTree;

  const refresh = useCallback(
    (options?: { force?: boolean }) => {
      if (!enabled) return;

      requestWorkspaceFileTreeRefresh({
        workspaceKey,
        machineId,
        workingDir: normalizedWorkingDir,
        force: !!options?.force,
        request: (args) => requestTree(!!args.force),
      });
    },
    [enabled, machineId, normalizedWorkingDir, requestTree, workspaceKey]
  );

  return useMemo(
    () => ({
      entries,
      treeEntries: storeEntries,
      isLoading,
      hasTree,
      refresh,
    }),
    [entries, storeEntries, hasTree, isLoading, refresh]
  );
}
