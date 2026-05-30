'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef } from 'react';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import { useFileEntries } from './useFileEntries';
import { useFileTree } from './useFileTree';

const REFRESH_DEDUP_WINDOW_MS = 1500;

export interface UseWorkspaceFileTreeArgs {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  /** Include directories in entries (for @ autocomplete). Default false. */
  includeDirectories?: boolean;
}

export interface UseWorkspaceFileTreeResult {
  entries: FileEntry[];
  treeJson: string | null;
  scannedAt: number | null;
  refresh: () => void;
  isLoading: boolean;
}

export function useWorkspaceFileTree({
  machineId,
  workingDir,
  enabled = true,
  includeDirectories = false,
}: UseWorkspaceFileTreeArgs): UseWorkspaceFileTreeResult {
  const requestFileTreeMutation = useSessionMutation(api.workspaceFiles.requestFileTree);
  const lastRefreshAtRef = useRef<number | null>(null);

  const treeResult = useFileTree(enabled ? { machineId, workingDir } : 'skip');
  const entries = useFileEntries(enabled ? treeResult : null, { includeDirectories });

  const refresh = useCallback(() => {
    if (!enabled) return;

    const now = Date.now();
    if (
      lastRefreshAtRef.current !== null &&
      now - lastRefreshAtRef.current < REFRESH_DEDUP_WINDOW_MS
    ) {
      return;
    }

    lastRefreshAtRef.current = now;
    requestFileTreeMutation({ machineId, workingDir }).catch(() => {
      // Non-blocking — tree may already be cached.
    });
  }, [machineId, workingDir, enabled, requestFileTreeMutation]);

  if (!enabled) {
    return {
      entries: [],
      treeJson: null,
      scannedAt: null,
      refresh,
      isLoading: false,
    };
  }

  return {
    entries,
    treeJson: treeResult?.treeJson ?? null,
    scannedAt: treeResult?.scannedAt ?? null,
    refresh,
    isLoading: treeResult === undefined && enabled,
  };
}
