'use client';

import type { Observable } from '@legendapp/state';
import { useSelector } from '@legendapp/state/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  acquireFileSelectorPartition,
  beginFileSelectorPreload,
  commitFileSelectorPreload,
  getFileSelectorPreloadFiles,
  releaseFileSelectorPartition,
  type FileSelectorPartitionState,
} from './fileSelectorPartitionStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { fileTreeEntriesToFileEntries } from '@/modules/chatroom/workspace/files/fileTreeUtils';
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
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === 'file-selector';
  const openRef = useRef(open);
  openRef.current = open;
  const setOpen = useCallback(
    (val: boolean) => (val ? openDialog('file-selector') : closeDialog()),
    [openDialog, closeDialog]
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const hasWorkspace = !!machineId && !!workingDir;
  const { entries, refresh, hasTree } = useWorkspaceFileTreeEntries({
    machineId: machineId ?? '',
    workingDir: workingDir ?? '',
    enabled: hasWorkspace,
    includeDirectories: false,
  });

  const [partitionState$, setPartitionState$] =
    useState<Observable<FileSelectorPartitionState> | null>(null);

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!chatroomId || !hasWorkspace || !machineId || !workingDir) return;

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

    const unsubscribe = subscribeWorkspaceFileTree(workspaceKey, tryCommit);

    const idleId =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(
            () => {
              refresh();
              tryCommit();
            },
            { timeout: 2000 }
          )
        : setTimeout(() => {
            refresh();
            tryCommit();
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
  }, [chatroomId, machineId, workingDir, hasWorkspace, refresh]);

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

  const liveFiles = useMemo(() => entries.filter((entry) => entry.type === 'file'), [entries]);

  const files = useMemo(() => {
    if (hasTree) return liveFiles;
    if (partitionStatus === 'ready') return preloadFiles;
    return liveFiles;
  }, [hasTree, liveFiles, partitionStatus, preloadFiles]);

  const isLoading = hasWorkspace && !hasTree && partitionStatus !== 'ready';

  useEffect(() => {
    if (!open || !hasWorkspace) return;
    const frame = requestAnimationFrame(() => {
      if (!openRef.current) return;
      refresh();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, hasWorkspace, refresh]);

  // Register Cmd+P / Ctrl+P shortcut (preventDefault blocks browser print dialog)
  useCommandDialogShortcut({ dialog: 'file-selector', key: 'p', shiftKey: 'forbidden' });

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
    open,
    setOpen,
    files,
    recentFiles,
    selectedFile,
    selectFile,
    isLoading,
    hasWorkspace,
  };
}
