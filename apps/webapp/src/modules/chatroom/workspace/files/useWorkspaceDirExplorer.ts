'use client';
// fallow-ignore-file complexity

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { isExplorerSearchMode } from './explorer-tree';
import { filterFileTreeEntries, fileTreeEntriesToExplorerNodes } from './fileTreeUtils';
import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';
import {
  getWorkspaceFileTreeEntries,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
} from './workspaceFileTreeStore';
import { filterExplorerTreeNodes, type ExplorerTreeNode } from '../components/explorerTreeFilter';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

export function useWorkspaceDirExplorer({
  machineId,
  workingDir,
  enabled = true,
  searchQuery = '',
  filterQuery = '',
  refreshSignal = 0,
}: {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  searchQuery?: string;
  /** VSCode-style short filter applied to built tree nodes */
  filterQuery?: string;
  refreshSignal?: number;
}): {
  rootNodes: ExplorerTreeNode[];
  displayNodes: ExplorerTreeNode[];
  isLoading: boolean;
  hasTree: boolean;
  refresh: () => void;
  isSearchMode: boolean;
} {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const workspaceKey = toWorkspaceFileTreeKey(machineId, normalizedWorkingDir);
  const mountPullRef = useRef(false);

  const {
    isLoading,
    hasTree,
    refresh: treeRefresh,
  } = useWorkspaceFileTreeEntries({
    machineId,
    workingDir: normalizedWorkingDir,
    enabled,
    includeDirectories: true,
  });

  const storeEntries = useSyncExternalStore(
    useCallback((listener) => subscribeWorkspaceFileTree(workspaceKey, listener), [workspaceKey]),
    () => getWorkspaceFileTreeEntries(workspaceKey),
    () => getWorkspaceFileTreeEntries(workspaceKey)
  );

  const trimmedSearch = searchQuery.trim();
  const isSearchMode = isExplorerSearchMode(trimmedSearch);

  const rootNodes = useMemo(() => {
    if (!enabled) return [];
    const entries = isSearchMode
      ? filterFileTreeEntries(storeEntries, trimmedSearch)
      : storeEntries;
    return fileTreeEntriesToExplorerNodes(entries);
  }, [enabled, isSearchMode, storeEntries, trimmedSearch]);

  const displayNodes = useMemo(() => {
    if (isSearchMode) return rootNodes;
    const trimmedFilter = filterQuery.trim();
    if (trimmedFilter) return filterExplorerTreeNodes(rootNodes, filterQuery);
    return rootNodes;
  }, [filterQuery, isSearchMode, rootNodes]);

  const refresh = useCallback(() => {
    treeRefresh({ force: true });
  }, [treeRefresh]);

  useEffect(() => {
    if (refreshSignal > 0) refresh();
  }, [refreshSignal, refresh]);

  useEffect(() => {
    if (!enabled) {
      mountPullRef.current = false;
      return;
    }
    if (mountPullRef.current) return;
    mountPullRef.current = true;
    treeRefresh();
  }, [enabled, treeRefresh]);

  return useMemo(
    () => ({
      rootNodes,
      displayNodes,
      isLoading,
      hasTree,
      refresh,
      isSearchMode,
    }),
    [displayNodes, hasTree, isLoading, isSearchMode, refresh, rootNodes]
  );
}
