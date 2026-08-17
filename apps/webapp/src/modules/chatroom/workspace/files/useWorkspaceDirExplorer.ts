'use client';
// fallow-ignore-file complexity

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { isExplorerSearchMode } from './explorer-tree';
import { filterFileTreeEntries, fileTreeEntriesToExplorerNodes } from './fileTreeUtils';
import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';
import { filterExplorerTreeNodes, type ExplorerTreeNode } from '../components/explorerTreeFilter';
import { toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

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
  const hydratedWorkspaceKeyRef = useRef<string | null>(null);

  const tree = useWorkspaceFileTree({ machineId, workingDir: normalizedWorkingDir, enabled });

  const {
    treeEntries,
    hasTree: entriesHasTree,
    refresh: treeRefresh,
  } = useWorkspaceFileTreeEntries({
    machineId,
    workingDir: normalizedWorkingDir,
    enabled,
    includeDirectories: true,
  });

  const trimmedSearch = searchQuery.trim();
  const isSearchMode = isExplorerSearchMode(trimmedSearch);

  const rootNodes = useMemo(() => {
    if (!enabled) return [];
    const entries = isSearchMode ? filterFileTreeEntries(treeEntries, trimmedSearch) : treeEntries;
    return fileTreeEntriesToExplorerNodes(entries);
  }, [enabled, isSearchMode, treeEntries, trimmedSearch]);

  const displayNodes = useMemo(() => {
    if (isSearchMode) return rootNodes;
    const trimmedFilter = filterQuery.trim();
    if (trimmedFilter) return filterExplorerTreeNodes(rootNodes, filterQuery);
    return rootNodes;
  }, [filterQuery, isSearchMode, rootNodes]);

  const refresh = useCallback(() => {
    tree.refresh({ force: true });
    treeRefresh({ force: true });
  }, [treeRefresh, tree]);

  useEffect(() => {
    if (refreshSignal > 0) refresh();
  }, [refreshSignal, refresh]);

  useEffect(() => {
    if (!enabled) {
      hydratedWorkspaceKeyRef.current = null;
      return;
    }
    if (hydratedWorkspaceKeyRef.current === workspaceKey) return;
    hydratedWorkspaceKeyRef.current = workspaceKey;
    if (tree.hasTree || entriesHasTree) return;
    treeRefresh();
  }, [enabled, entriesHasTree, tree.hasTree, treeRefresh, workspaceKey]);

  return useMemo(
    () => ({
      rootNodes,
      displayNodes,
      isLoading: tree.isLoading,
      hasTree: tree.hasTree || entriesHasTree,
      refresh,
      isSearchMode,
    }),
    [displayNodes, entriesHasTree, isSearchMode, refresh, rootNodes, tree.hasTree, tree.isLoading]
  );
}
