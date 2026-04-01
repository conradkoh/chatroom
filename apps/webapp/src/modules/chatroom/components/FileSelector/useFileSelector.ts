'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

interface UseFileSelectorOptions {
  machineId: string | null;
  workingDir: string | null;
}

export interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export function useFileSelector({ machineId, workingDir }: UseFileSelectorOptions) {
  const [open, setOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Fetch file tree
  const treeResult = useSessionQuery(
    api.workspaceFiles.getFileTree,
    machineId && workingDir ? { machineId, workingDir } : 'skip'
  );

  // Parse file tree entries
  const entries: FileEntry[] = (() => {
    if (!treeResult?.treeJson) return [];
    try {
      const tree = JSON.parse(treeResult.treeJson);
      return (tree.entries ?? []) as FileEntry[];
    } catch {
      return [];
    }
  })();

  // Files only (no directories) for the list
  const files = entries.filter((e) => e.type === 'file');

  // Register Cmd+P / Ctrl+P shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const triggerKey = isMac ? e.metaKey : e.ctrlKey;

      if (triggerKey && e.key === 'p') {
        e.preventDefault(); // Prevent browser print dialog
        setOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // When a file is selected from the modal
  const selectFile = useCallback((filePath: string) => {
    setSelectedFile(filePath || null);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  return {
    open,
    setOpen,
    close,
    files,
    selectedFile,
    selectFile,
    hasTree: !!treeResult,
    isLoading: treeResult === undefined && !!machineId && !!workingDir,
    hasWorkspace: !!machineId && !!workingDir,
  };
}
