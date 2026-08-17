'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { isExplorerSearchMode } from './explorer-tree';
import { filterFileTreeEntries, fileTreeEntriesToExplorerNodes } from './fileTreeUtils';
import { useFileTreeWatchEnabled } from './useFileTreeWatch';
import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';
import { filterExplorerTreeNodes, type ExplorerTreeNode } from '../components/explorerTreeFilter';
import { toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

export type WorkspaceExplorerEmptyState = 'loading' | 'error' | 'syncing' | 'never-synced' | null;

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
  loadError: string | null;
  explorerEmptyState: WorkspaceExplorerEmptyState;
  isNeverSynced: boolean;
} {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const workspaceKey = toWorkspaceFileTreeKey(machineId, normalizedWorkingDir);
  const hydratedWorkspaceKeyRef = useRef<string | null>(null);
  const watchEnabled = useFileTreeWatchEnabled(machineId, normalizedWorkingDir);
  const syncEnabled = enabled && watchEnabled;
  const pendingRequestsRaw = useSessionQuery(
    api.workspaceFiles.getPendingFileTreeRequests,
    syncEnabled ? { machineId } : 'skip'
  );
  const hasPendingSync = useMemo(
    () =>
      !!pendingRequestsRaw?.some(
        (request) => normalizeWorkspaceWorkingDir(request.workingDir) === normalizedWorkingDir
      ),
    [normalizedWorkingDir, pendingRequestsRaw]
  );

  const tree = useWorkspaceFileTree({
    machineId,
    workingDir: normalizedWorkingDir,
    enabled: syncEnabled,
  });

  const {
    treeEntries,
    hasTree: entriesHasTree,
    refresh: treeRefresh,
  } = useWorkspaceFileTreeEntries({
    machineId,
    workingDir: normalizedWorkingDir,
    enabled: syncEnabled,
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

  const explorerEmptyState = useMemo<WorkspaceExplorerEmptyState>(() => {
    if (!enabled) return null;
    if (tree.loadError) return 'error';
    if (tree.isLoading) return 'loading';
    if (!tree.hasTree && !entriesHasTree) {
      if (hasPendingSync) return 'syncing';
      if (tree.isNeverSynced) return 'never-synced';
    }
    return null;
  }, [
    enabled,
    entriesHasTree,
    hasPendingSync,
    tree.hasTree,
    tree.isLoading,
    tree.isNeverSynced,
    tree.loadError,
  ]);

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
      loadError: tree.loadError,
      explorerEmptyState,
      isNeverSynced: tree.isNeverSynced,
    }),
    [
      displayNodes,
      entriesHasTree,
      isSearchMode,
      refresh,
      rootNodes,
      tree.hasTree,
      tree.isLoading,
      tree.loadError,
      explorerEmptyState,
      tree.isNeverSynced,
    ]
  );
}
