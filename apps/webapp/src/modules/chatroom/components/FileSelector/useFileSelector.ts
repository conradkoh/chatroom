'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { useCommandDialog } from '@/modules/chatroom/context/CommandDialogContext';
import { useFileTree } from '@/modules/chatroom/workspace/hooks/useFileTree';
import { useFileEntries } from '@/modules/chatroom/hooks/useFileEntries';

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

  // Request file tree mutation
  const requestFileTreeMutation = useSessionMutation(api.workspaceFiles.requestFileTree);

  // Fetch file tree — only subscribe when the file selector is open
  const treeResult = useFileTree(
    open && machineId && workingDir ? { machineId, workingDir } : 'skip'
  );

  // Request a fresh file tree scan when the selector opens
  useEffect(() => {
    if (open && machineId && workingDir) {
      requestFileTreeMutation({ machineId, workingDir }).catch(() => {
        // Non-blocking — tree may already be cached
      });
    }
  }, [open, machineId, workingDir, requestFileTreeMutation]);

  // Parse file tree entries (files only)
  const files = useFileEntries(treeResult);

  // Register Cmd+P / Ctrl+P shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const triggerKey = isMac ? e.metaKey : e.ctrlKey;

      if (triggerKey && !e.shiftKey && e.key === 'p') {
        e.preventDefault(); // Prevent browser print dialog
        if (open) {
          closeDialog();
        } else {
          openDialog('file-selector');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openDialog, closeDialog]);

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
    hasTree: !!treeResult,
    isLoading: treeResult === undefined && !!machineId && !!workingDir,
    hasWorkspace: !!machineId && !!workingDir,
  };
}
