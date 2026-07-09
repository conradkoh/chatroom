'use client';

import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  dirEntriesToNodes,
  isExplorerSearchMode,
  searchEntriesToNodes,
  sortExplorerNodes,
  type ExplorerTreeNode,
} from './explorer-tree';
import {
  clearTrackedWorkspace,
  toTrackedWorkspaceKey,
  upsertTrackedDirListing,
} from './trackedWorkspaceFilesStore';
import { useDirListing } from './useDirListing';
import { useFileSearch } from './useFileSearch';

// fallow-ignore-next-line complexity
function dirEntriesEqual(a: DirListingEntry[] | undefined, b: DirListingEntry[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.name !== right.name || left.type !== right.type) return false;
  }
  return true;
}

/** Hidden component that subscribes to one directory listing and reports updates. */
export function DirListingWatcher({
  machineId,
  workingDir,
  dirPath,
  refreshToken,
  onUpdate,
}: {
  machineId: string;
  workingDir: string;
  dirPath: string;
  refreshToken: number;
  onUpdate: (dirPath: string, entries: DirListingEntry[], isLoading: boolean) => void;
}) {
  const { entries, isLoading, refresh } = useDirListing({ machineId, workingDir, dirPath });

  useEffect(() => {
    if (refreshToken > 0) refresh();
  }, [refreshToken, refresh]);

  useEffect(() => {
    onUpdate(dirPath, entries, isLoading);
  }, [dirPath, entries, isLoading, onUpdate]);

  return null;
}

// fallow-ignore-next-line complexity
export function useWorkspaceDirExplorer({
  machineId,
  workingDir,
  enabled = true,
  searchQuery = '',
  refreshSignal = 0,
}: {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  searchQuery?: string;
  /** Increment to refetch listings without remounting the explorer tree. */
  refreshSignal?: number;
}) {
  const trimmedSearch = searchQuery.trim();
  const isSearchMode = isExplorerSearchMode(trimmedSearch);

  const {
    entries: rootEntries,
    isLoading: rootIsLoading,
    refresh: refreshRootListing,
  } = useDirListing(enabled && !isSearchMode ? { machineId, workingDir, dirPath: '' } : 'skip');
  const {
    entries: searchEntries,
    isLoading: searchIsLoading,
    refresh: refreshFileSearch,
  } = useFileSearch(
    enabled && isSearchMode ? { machineId, workingDir, query: trimmedSearch } : 'skip'
  );

  const [requestedDirs, setRequestedDirs] = useState<string[]>([]);
  const [childMap, setChildMap] = useState<Map<string, DirListingEntry[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [refreshToken, setRefreshToken] = useState(0);

  const workspaceKey =
    enabled && machineId && workingDir ? toTrackedWorkspaceKey(machineId, workingDir) : '';

  useEffect(() => {
    if (!workspaceKey || isSearchMode) return;
    upsertTrackedDirListing(workspaceKey, '', rootEntries);
  }, [workspaceKey, isSearchMode, rootEntries]);

  useEffect(() => {
    if (!workspaceKey) return;
    return () => {
      clearTrackedWorkspace(workspaceKey);
    };
  }, [workspaceKey]);

  const handleDirUpdate = useCallback(
    (dirPath: string, entries: DirListingEntry[], isLoading: boolean) => {
      setChildMap((prev) => {
        const existing = prev.get(dirPath);
        if (dirEntriesEqual(existing, entries)) return prev;
        const next = new Map(prev);
        next.set(dirPath, entries);
        return next;
      });
      setLoadingDirs((prev) => {
        const wasLoading = prev.has(dirPath);
        if (isLoading === wasLoading) return prev;
        const next = new Set(prev);
        if (isLoading) next.add(dirPath);
        else next.delete(dirPath);
        return next;
      });
      if (workspaceKey) {
        upsertTrackedDirListing(workspaceKey, dirPath, entries);
      }
    },
    [workspaceKey]
  );

  const loadChildren = useCallback((dirPath: string) => {
    setRequestedDirs((prev) => {
      if (prev.includes(dirPath)) return prev;
      setLoadingDirs((loadingPrev) => {
        if (loadingPrev.has(dirPath)) return loadingPrev;
        const loadingNext = new Set(loadingPrev);
        loadingNext.add(dirPath);
        return loadingNext;
      });
      return [...prev, dirPath];
    });
  }, []);

  const refresh = useCallback(() => {
    refreshRootListing();
    refreshFileSearch();
    setRefreshToken((t) => t + 1);
  }, [refreshRootListing, refreshFileSearch]);

  useEffect(() => {
    if (refreshSignal > 0) refresh();
  }, [refreshSignal, refresh]);

  const attachChildren = useCallback(
    (nodes: ExplorerTreeNode[]): ExplorerTreeNode[] =>
      nodes.map((node) => {
        if (node.type !== 'directory') return node;
        const loaded = childMap.get(node.path);
        const children = loaded ? attachChildren(dirEntriesToNodes(loaded)) : [];
        return { ...node, children };
      }),
    [childMap]
  );

  const rootNodes = useMemo(() => {
    if (isSearchMode) return searchEntriesToNodes(searchEntries);
    return attachChildren(sortExplorerNodes(dirEntriesToNodes(rootEntries)));
  }, [isSearchMode, searchEntries, rootEntries, attachChildren]);

  return {
    rootNodes,
    childMap,
    loadingDirs,
    requestedDirs,
    loadChildren,
    isLoading: isSearchMode ? searchIsLoading : rootIsLoading,
    refresh,
    isSearchMode,
    refreshToken,
    handleDirUpdate,
  };
}
