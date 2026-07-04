'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef } from 'react';

import { useFileEntries } from './useFileEntries';
import { useFileSearch } from './useFileSearch';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const REFRESH_DEDUP_WINDOW_MS = 1500;

export interface UseWorkspaceFileListingArgs {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  /** Include directories in entries (for @ autocomplete). Default false. */
  includeDirectories?: boolean;
}

export interface UseWorkspaceFileListingResult {
  entries: FileEntry[];
  scannedAt: number | null;
  refresh: () => void;
  isLoading: boolean;
}

export function useWorkspaceFileListing({
  machineId,
  workingDir,
  enabled = true,
  includeDirectories = false,
}: UseWorkspaceFileListingArgs): UseWorkspaceFileListingResult {
  const requestFileSearchMutation = useSessionMutation(api.workspaceFiles.requestFileSearch);
  const lastRefreshAtRef = useRef<number | null>(null);

  const searchResult = useFileSearch(
    enabled ? { machineId, workingDir, query: '', enabled: true } : 'skip'
  );

  // Empty query triggers workspace-wide file listing on daemon
  useEffect(() => {
    if (!enabled) return;
    requestFileSearchMutation({ machineId, workingDir, query: '' }).catch(() => {});
  }, [enabled, machineId, workingDir, requestFileSearchMutation]);

  const entries = useFileEntries(
    enabled ? { entries: searchResult.entries as FileEntry[] } : null,
    { includeDirectories }
  );

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
    requestFileSearchMutation({ machineId, workingDir, query: '', force: true }).catch(() => {});
    searchResult.refresh();
  }, [machineId, workingDir, enabled, requestFileSearchMutation, searchResult]);

  if (!enabled) {
    return {
      entries: [],
      scannedAt: null,
      refresh,
      isLoading: false,
    };
  }

  return {
    entries,
    scannedAt: null,
    refresh,
    isLoading: searchResult.isLoading,
  };
}
