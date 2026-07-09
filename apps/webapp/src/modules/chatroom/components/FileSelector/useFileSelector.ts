'use client';

import { useCallback, useEffect, useState } from 'react';

import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useCommandDialogShortcut } from '@/modules/chatroom/hooks/useCommandDialogShortcut';
import { useWorkspaceFileListing } from '@/modules/chatroom/workspace/files';

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

export function useFileSelector({ chatroomId, machineId, workingDir }: UseFileSelectorOptions) {
  const { activeDialog, openDialog, closeDialog } = useCommandDialog();
  const open = activeDialog === 'file-selector';
  const setOpen = useCallback(
    (val: boolean) => (val ? openDialog('file-selector') : closeDialog()),
    [openDialog, closeDialog]
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const hasWorkspace = !!machineId && !!workingDir;
  const {
    entries: files,
    refresh,
    isLoading,
  } = useWorkspaceFileListing({
    machineId: machineId ?? '',
    workingDir: workingDir ?? '',
    enabled: open && hasWorkspace,
  });

  // Request a fresh file listing when the selector opens
  useEffect(() => {
    if (open && hasWorkspace) {
      refresh();
    }
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
