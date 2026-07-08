'use client';
// fallow-ignore-file complexity

import { useCallback, useMemo, useRef } from 'react';

import { useDirListing } from './useDirListing';
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

function mergeFileEntries(fileEntries: FileEntry[], directoryEntries: FileEntry[]): FileEntry[] {
  if (directoryEntries.length === 0) return fileEntries;
  if (fileEntries.length === 0) return directoryEntries;

  const seen = new Set(fileEntries.map((entry) => entry.path));
  const merged = [...fileEntries];
  for (const entry of directoryEntries) {
    if (seen.has(entry.path)) continue;
    merged.push(entry);
  }
  return merged;
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
  const dirListingResult = useDirListing(
    enabled && includeDirectories ? { machineId, workingDir, dirPath: '' } : 'skip'
  );

  const fileEntries = useFileEntries(
    enabled ? { entries: searchResult.entries as FileEntry[] } : null,
    { includeDirectories: false }
  );
  const directoryEntries = useFileEntries(
    enabled && includeDirectories ? { entries: dirListingResult.entries as FileEntry[] } : null,
    { includeDirectories: true }
  );

  const entries = useMemo(() => {
    if (!enabled) return [];
    if (!includeDirectories) return fileEntries;
    return mergeFileEntries(
      fileEntries,
      directoryEntries.filter((entry) => entry.type === 'directory')
    );
  }, [directoryEntries, enabled, fileEntries, includeDirectories]);

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
    if (includeDirectories) {
      dirListingResult.refresh();
    }
  }, [dirListingResult, enabled, includeDirectories, searchResult]);

  if (!enabled) {
    return { entries: [], refresh, isLoading: false };
  }

  return {
    entries,
    refresh,
    isLoading: searchResult.isLoading || (includeDirectories && dirListingResult.isLoading),
  };
}
