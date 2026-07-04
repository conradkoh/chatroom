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
import { useDirListing } from './useDirListing';
import { useFileSearch } from './useFileSearch';

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
  const listing = useDirListing({ machineId, workingDir, dirPath });

  useEffect(() => {
    if (refreshToken > 0) listing.refresh();
  }, [refreshToken, listing.refresh]);

  useEffect(() => {
    onUpdate(dirPath, listing.entries, listing.isLoading);
  }, [dirPath, listing.entries, listing.isLoading, onUpdate]);

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

  const rootListing = useDirListing(
    enabled && !isSearchMode ? { machineId, workingDir, dirPath: '' } : 'skip'
  );
  const fileSearch = useFileSearch(
    enabled && isSearchMode ? { machineId, workingDir, query: trimmedSearch } : 'skip'
  );

  const [requestedDirs, setRequestedDirs] = useState<string[]>([]);
  const [childMap, setChildMap] = useState<Map<string, DirListingEntry[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [refreshToken, setRefreshToken] = useState(0);

  const handleDirUpdate = useCallback(
    (dirPath: string, entries: DirListingEntry[], isLoading: boolean) => {
      setChildMap((prev) => {
        const next = new Map(prev);
        next.set(dirPath, entries);
        return next;
      });
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        if (isLoading) next.add(dirPath);
        else next.delete(dirPath);
        return next;
      });
    },
    []
  );

  const loadChildren = useCallback((dirPath: string) => {
    setRequestedDirs((prev) => (prev.includes(dirPath) ? prev : [...prev, dirPath]));
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
  }, []);

  const refresh = useCallback(() => {
    rootListing.refresh();
    fileSearch.refresh();
    setRefreshToken((t) => t + 1);
  }, [rootListing, fileSearch]);

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
    if (isSearchMode) return searchEntriesToNodes(fileSearch.entries);
    return attachChildren(sortExplorerNodes(dirEntriesToNodes(rootListing.entries)));
  }, [isSearchMode, fileSearch.entries, rootListing.entries, attachChildren]);

  return {
    rootNodes,
    childMap,
    loadingDirs,
    requestedDirs,
    loadChildren,
    isLoading: isSearchMode ? fileSearch.isLoading : rootListing.isLoading,
    refresh,
    isSearchMode,
    refreshToken,
    handleDirUpdate,
  };
}
