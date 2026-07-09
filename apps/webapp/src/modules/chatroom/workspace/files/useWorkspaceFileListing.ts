'use client';
// fallow-ignore-file complexity

import { useCallback, useMemo, useRef } from 'react';

import { useDirListing } from './useDirListing';
import { useFileEntries } from './useFileEntries';
import { useFileSearch } from './useFileSearch';
import { useTrackedWorkspaceFiles } from './useTrackedWorkspaceFiles';

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

function mergeFileEntries(...groups: FileEntry[][]): FileEntry[] {
  const seen = new Set<string>();
  const merged: FileEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      merged.push(entry);
    }
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
  const trackedEntries = useTrackedWorkspaceFiles(machineId, workingDir, enabled);

  const entries = useMemo(() => {
    if (!enabled) return [];
    if (!includeDirectories) {
      return mergeFileEntries(
        fileEntries,
        trackedEntries.filter((entry) => entry.type === 'file')
      );
    }
    return mergeFileEntries(
      fileEntries,
      directoryEntries.filter((entry) => entry.type === 'directory'),
      trackedEntries
    );
  }, [directoryEntries, enabled, fileEntries, includeDirectories, trackedEntries]);

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
