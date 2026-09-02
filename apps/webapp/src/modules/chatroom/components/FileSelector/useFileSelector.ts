'use client';

import type { Observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { api } from '@workspace/backend/convex/_generated/api';
import { FILE_TREE_SNAPSHOT_STALENESS_MS } from '@workspace/backend/src/domain/constants/workspace-file-tree-watch';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

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
import {
  EMPTY_FILE_TREE_ENTRIES,
  getWorkspaceFileTreeEntries,
  getWorkspaceFileTreeRevision,
  getWorkspaceFileTreeScannedAt,
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
  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);
  const normalizedWorkingDir = workingDir ? normalizeWorkspaceWorkingDir(workingDir) : '';
  const workspaceKey =
    machineId && normalizedWorkingDir
      ? toWorkspaceFileTreeKey(machineId, normalizedWorkingDir)
      : '';
  const subscribeStore = useCallback(
    (listener: () => void) =>
      workspaceKey ? subscribeWorkspaceFileTree(workspaceKey, listener) : () => {},
    [workspaceKey]
  );
  const getStoreEntries = useCallback(
    () => (workspaceKey ? getWorkspaceFileTreeEntries(workspaceKey) : EMPTY_FILE_TREE_ENTRIES),
    [workspaceKey]
  );
  const entries = useSyncExternalStore(subscribeStore, getStoreEntries, getStoreEntries);
  const revision = workspaceKey ? getWorkspaceFileTreeRevision(workspaceKey) : null;
  const refresh = useCallback(
    // fallow-ignore-next-line complexity
    (options?: { force?: boolean }) => {
      if (!machineId || !normalizedWorkingDir) return;
      void requestMutation({
        machineId,
        workingDir: normalizedWorkingDir,
        ...(options?.force ? { force: true } : {}),
      }).catch(() => {});
    },
    [machineId, normalizedWorkingDir, requestMutation]
  );

  const wasOpenRef = useRef(false);
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!fileSelectorOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current || !machineId || !normalizedWorkingDir || !workspaceKey) return;
    wasOpenRef.current = true;

    const scannedAt = getWorkspaceFileTreeScannedAt(workspaceKey);
    const stale =
      entries.length === 0 ||
      scannedAt === null ||
      Date.now() - scannedAt > FILE_TREE_SNAPSHOT_STALENESS_MS;
    if (stale) {
      void requestMutation({ machineId, workingDir: normalizedWorkingDir }).catch(() => {});
    }
  }, [
    entries.length,
    fileSelectorOpen,
    machineId,
    normalizedWorkingDir,
    requestMutation,
    workspaceKey,
  ]);

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
      commitFileSelectorPreload(state$, generation, []);
    };

    const unsubscribe = subscribeWorkspaceFileTree(workspaceKey, tryCommitOrSettleEmpty);

    const idleId =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(
            () => {
              tryCommitOrSettleEmpty();
            },
            { timeout: 2000 }
          )
        : setTimeout(() => {
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
  }, [chatroomId, machineId, workingDir, hasWorkspace, fileSelectorOpen]);

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

  const hasTree = revision !== null || entries.length > 0;
  const loadError = null;
  const isNeverSynced = hasWorkspace && !hasTree;
  const isSyncing = false;

  const liveFiles = useMemo(
    () => fileTreeEntriesToFileEntries(entries).filter((entry) => entry.type === 'file'),
    [entries]
  );

  const files = useMemo(() => {
    if (hasTree) return liveFiles;
    if (partitionStatus === 'ready') return preloadFiles;
    return liveFiles;
  }, [hasTree, liveFiles, partitionStatus, preloadFiles]);

  const isLoading = false;

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
