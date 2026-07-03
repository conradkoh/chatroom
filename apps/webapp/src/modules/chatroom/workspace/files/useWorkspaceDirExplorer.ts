'use client';

import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDirListing } from './useDirListing';
import { useFileSearch } from './useFileSearch';

import { isPathPendingDelete } from '@/modules/chatroom/workspace/hooks/pendingOptimisticDeletePaths';

export interface ExplorerTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: ExplorerTreeNode[];
}

function dirEntriesToNodes(entries: DirListingEntry[]): ExplorerTreeNode[] {
  return entries
    .filter((e) => !isPathPendingDelete(e.path))
    .map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      children: [],
    }));
}

function sortNodes(nodes: ExplorerTreeNode[]): ExplorerTreeNode[] {
  return (
    nodes
      .map((n) => ({
        ...n,
        children: n.type === 'directory' ? sortNodes(n.children) : [],
      }))
      // fallow-ignore-next-line complexity code-duplication
      .sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      })
  );
}

// fallow-ignore-next-line complexity
function searchEntriesToNodes(entries: { path: string; type: 'file' }[]): ExplorerTreeNode[] {
  const root: ExplorerTreeNode = { name: '', path: '', type: 'directory', children: [] };

  for (const entry of entries) {
    if (isPathPendingDelete(entry.path)) continue;
    const parts = entry.path.split('/').filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');

      if (isLast) {
        current.children.push({ name: part, path: entry.path, type: 'file', children: [] });
      } else {
        let child = current.children.find((c) => c.path === childPath && c.type === 'directory');
        if (!child) {
          child = { name: part, path: childPath, type: 'directory', children: [] };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  return sortNodes(root.children);
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
}: {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  searchQuery?: string;
}) {
  const trimmedSearch = searchQuery.trim();
  const isSearchMode = trimmedSearch.length >= 2;

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
    return attachChildren(sortNodes(dirEntriesToNodes(rootListing.entries)));
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
