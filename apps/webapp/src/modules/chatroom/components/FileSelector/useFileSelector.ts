'use client';

import type { Observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  acquireFileSelectorPartition,
  beginFileSelectorPreload,
  commitFileSelectorPreload,
  getFileSelectorPreloadFiles,
  releaseFileSelectorPartition,
  type FileSelectorPartitionState,
} from './fileSelectorPartitionStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import {
  getFileSelectorOpen,
  subscribeActiveContextManagedDialog,
} from '@/modules/chatroom/context/contextManagedDialogsController';
import { fileTreeEntriesToFileEntries } from '@/modules/chatroom/workspace/files/fileTreeUtils';
import { useAcquireFileTreeWatch } from '@/modules/chatroom/workspace/files/useFileTreeWatch';
import { useWorkspaceFileTree } from '@/modules/chatroom/workspace/files/useWorkspaceFileTree';
import { useWorkspaceFileTreeEntries } from '@/modules/chatroom/workspace/files/useWorkspaceFileTreeEntries';
import {
  getWorkspaceFileTreeEntries,
  getWorkspaceFileTreeRevision,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
} from '@/modules/chatroom/workspace/stores/workspaceFileTreeStore';

interface UseFileSelectorOptions {
  chatroomId?: string;
  machineId: string | null;
  workingDir: string | null;
}

export interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: number;
  /** Encoded workspace identifier (base64url of machineId::workingDir). Present for multi-workspace autocomplete. */
  workspaceId?: string;
}

function getRecentFilesStorageKey(chatroomId?: string) {
  return `fileSelector:recent:${chatroomId ?? 'global'}`;
}

function readRecentFiles(storageKey: string) {
  if (typeof window === 'undefined') return [];

  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[];
  } catch {
    return [];
  }
}

// fallow-ignore-next-line complexity
export function useFileSelector({ chatroomId, machineId, workingDir }: UseFileSelectorOptions) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const hasWorkspace = !!machineId && !!workingDir;
  const fileSelectorOpen = useSyncExternalStore(
    subscribeActiveContextManagedDialog,
    getFileSelectorOpen,
    () => false
  );
  const syncEnabled = hasWorkspace && fileSelectorOpen;
  useAcquireFileTreeWatch(machineId, workingDir, syncEnabled);

  const tree = useWorkspaceFileTree({
    machineId: machineId ?? '',
    workingDir: workingDir ?? '',
    enabled: syncEnabled,
  });
  const treeIsLoading = tree.isLoading;
  const pendingRequestsRaw = useSessionQuery(
    api.workspaceFiles.getPendingFileTreeRequests,
    syncEnabled && machineId ? { machineId } : 'skip'
  );
  const hasPendingSync = useMemo(() => {
    if (!syncEnabled || !workingDir) return false;
    const normalized = normalizeWorkspaceWorkingDir(workingDir);
    return !!pendingRequestsRaw?.some(
      (request) => normalizeWorkspaceWorkingDir(request.workingDir) === normalized
    );
  }, [pendingRequestsRaw, syncEnabled, workingDir]);

  const {
    entries,
    refresh: refreshEntries,
    hasTree: entriesHasTree,
  } = useWorkspaceFileTreeEntries({
    machineId: machineId ?? '',
    workingDir: workingDir ?? '',
    enabled: syncEnabled,
    includeDirectories: false,
  });

  const refresh = useCallback(
    (options?: { force?: boolean }) => {
      tree.refresh(options);
      refreshEntries(options);
    },
    [tree, refreshEntries]
  );

  const [partitionState$, setPartitionState$] =
    useState<Observable<FileSelectorPartitionState> | null>(null);

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!chatroomId || !hasWorkspace || !machineId || !workingDir || !fileSelectorOpen) return;

    const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
    const workspaceKey = toWorkspaceFileTreeKey(machineId, normalizedWorkingDir);
    const state$ = acquireFileSelectorPartition(chatroomId, machineId, workingDir);
    setPartitionState$(state$);
    const generation = beginFileSelectorPreload(state$);

    const tryCommit = () => {
      const storeEntries = getWorkspaceFileTreeEntries(workspaceKey);
      const revision = getWorkspaceFileTreeRevision(workspaceKey);
      if (revision !== null || storeEntries.length > 0) {
        const fileEntries = fileTreeEntriesToFileEntries(storeEntries).filter(
          (e) => e.type === 'file'
        );
        commitFileSelectorPreload(state$, generation, fileEntries);
        return true;
      }
      return false;
    };

    const tryCommitOrSettleEmpty = () => {
      if (tryCommit()) return;
      // Hydration settled with no store data — commit empty so partition reaches 'ready'.
      if (!treeIsLoading) commitFileSelectorPreload(state$, generation, []);
    };

    const unsubscribe = subscribeWorkspaceFileTree(workspaceKey, tryCommitOrSettleEmpty);

    const idleId =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(
            () => {
              if (fileSelectorOpen) refresh();
              tryCommitOrSettleEmpty();
            },
            { timeout: 2000 }
          )
        : setTimeout(() => {
            if (fileSelectorOpen) refresh();
            tryCommitOrSettleEmpty();
          }, 0);

    return () => {
      if (typeof cancelIdleCallback !== 'undefined' && typeof idleId === 'number') {
        cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as ReturnType<typeof setTimeout>);
      }
      unsubscribe();
      releaseFileSelectorPartition(chatroomId, machineId, workingDir);
      setPartitionState$(null);
    };
  }, [chatroomId, machineId, workingDir, hasWorkspace, refresh, fileSelectorOpen, treeIsLoading]);

  const { preloadFiles, partitionStatus } = useSelector(() => {
    if (!partitionState$) {
      return { preloadFiles: [] as FileEntry[], partitionStatus: 'idle' as const };
    }
    const status = partitionState$.status.get();
    const partitionKey = partitionState$.partitionKey.get();
    return {
      partitionStatus: status,
      preloadFiles: status === 'ready' ? getFileSelectorPreloadFiles(partitionKey) : [],
    };
  });

  const hasTree = entriesHasTree || tree.hasTree;
  const loadError = hasWorkspace ? tree.loadError : null;
  const isNeverSynced =
    hasWorkspace && !hasTree && !treeIsLoading && !loadError && tree.isNeverSynced;
  const isSyncing = hasWorkspace && !hasTree && !treeIsLoading && !loadError && hasPendingSync;

  const liveFiles = useMemo(() => entries.filter((entry) => entry.type === 'file'), [entries]);

  const files = useMemo(() => {
    if (hasTree) return liveFiles;
    if (partitionStatus === 'ready') return preloadFiles;
    return liveFiles;
  }, [hasTree, liveFiles, partitionStatus, preloadFiles]);

  const isLoading = hasWorkspace && treeIsLoading;

  const recentFilesStorageKey = getRecentFilesStorageKey(chatroomId);

  // Recently opened files (persisted in localStorage)
  const [recentFiles, setRecentFiles] = useState<string[]>(() =>
    readRecentFiles(recentFilesStorageKey)
  );

  useEffect(() => {
    setRecentFiles(readRecentFiles(recentFilesStorageKey));
  }, [recentFilesStorageKey]);

  // When a file is selected from the modal
  const selectFile = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath || null);
      if (filePath) {
        setRecentFiles((prev) => {
          const updated = [filePath, ...prev.filter((p) => p !== filePath)].slice(0, 5);
          try {
            localStorage.setItem(recentFilesStorageKey, JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
    },
    [recentFilesStorageKey]
  );

  return {
    files,
    recentFiles,
    selectedFile,
    selectFile,
    isLoading,
    isSyncing,
    isNeverSynced,
    loadError,
    hasWorkspace,
    refresh,
  };
}
