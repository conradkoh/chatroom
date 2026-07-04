'use client';

import { useCallback, useRef } from 'react';

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
  refresh: () => void;
  isLoading: boolean;
}

export function useWorkspaceFileListing({
  machineId,
  workingDir,
  enabled = true,
  includeDirectories = false,
}: UseWorkspaceFileListingArgs): UseWorkspaceFileListingResult {
  const lastRefreshAtRef = useRef<number | null>(null);

  const searchResult = useFileSearch(
    enabled ? { machineId, workingDir, query: '', enabled: true } : 'skip'
  );

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
    searchResult.refresh();
  }, [enabled, searchResult]);

  if (!enabled) {
    return { entries: [], refresh, isLoading: false };
  }

  return { entries, refresh, isLoading: searchResult.isLoading };
}
