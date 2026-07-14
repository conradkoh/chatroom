'use client';
// fallow-ignore-file code-duplication complexity

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

import { fileTreeEntriesToFileEntries } from './fileTreeUtils';
import { useWorkspaceFileTreeDeltaSync } from './useWorkspaceFileTreeDeltaSync';
import {
  getWorkspaceFileTreeEntries,
  getWorkspaceFileTreeRevision,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
} from './workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const REFRESH_DEDUP_WINDOW_MS = 1500;
const EMPTY_ENTRIES: FileEntry[] = [];

export interface UseWorkspaceFileTreeEntriesArgs {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  includeDirectories?: boolean;
}

export interface UseWorkspaceFileTreeEntriesResult {
  entries: FileEntry[];
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
  const lastRefreshAtRef = useRef<number | null>(null);
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const workspaceKey = toWorkspaceFileTreeKey(machineId, normalizedWorkingDir);

  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);

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
  const storeRevision = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeRevision(workspaceKey),
    () => getWorkspaceFileTreeRevision(workspaceKey)
  );

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

      const now = Date.now();
      if (
        lastRefreshAtRef.current !== null &&
        now - lastRefreshAtRef.current < REFRESH_DEDUP_WINDOW_MS
      ) {
        return;
      }
      lastRefreshAtRef.current = now;

      const force = !!options?.force;
      requestMutation({
        machineId,
        workingDir: normalizedWorkingDir,
        ...(force ? { force: true } : {}),
      }).catch(() => {});
    },
    [enabled, machineId, normalizedWorkingDir, requestMutation]
  );

  return useMemo(
    () => ({
      entries,
      isLoading,
      hasTree,
      refresh,
    }),
    [entries, hasTree, isLoading, refresh]
  );
}
