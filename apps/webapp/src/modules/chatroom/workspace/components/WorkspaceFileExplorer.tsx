'use client';

import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';

import { collectExpandedDirsForFilter, type ExplorerTreeNode } from './explorerTreeFilter';
import { WorkspaceFileExplorerVirtualizedTree } from './WorkspaceFileExplorerVirtualizedTree';
import { isExplorerSearchMode } from '../files/explorer-tree';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { useWorkspaceDirExplorer } from '@/modules/chatroom/workspace/files';

const EMPTY_LOADING_DIRS = new Set<string>();

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExplorerDeleteTarget = { path: string; type: 'file' | 'directory' };

interface WorkspaceFileExplorerProps {
  chatroomId?: string;
  machineId: string;
  workingDir: string;
  /** Increment to refetch directory listings (parent-owned refresh signal). */
  refreshSignal?: number;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  /** When set, auto-expand tree to reveal this file path */
  revealPath?: string | null;
  /** When set, visually highlights and scrolls to this path */
  selectedPath: string | null;
  /** Optional filename filter (VSCode-style explorer search) */
  filterQuery?: string;
  dropHighlightPath?: string | null;
  onNodeContextMenu?: (node: ExplorerTreeNode, event: MouseEvent) => void;
  onEmptyAreaContextMenu?: (event: MouseEvent) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExpandedPathsStorageKey(chatroomId?: string, workingDir?: string) {
  return `fileExplorer:expandedPaths:${chatroomId ?? 'global'}:${workingDir ?? ''}`;
}

function readExpandedPaths(storageKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function writeExpandedPaths(storageKey: string, paths: Set<string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...paths]));
  } catch {}
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const WorkspaceFileExplorer = memo(function WorkspaceFileExplorer({
  chatroomId,
  machineId,
  workingDir,
  refreshSignal = 0,
  onFileSelect,
  onFileDoubleClick,
  revealPath,
  selectedPath,
  filterQuery = '',
  dropHighlightPath = null,
  onNodeContextMenu,
  onEmptyAreaContextMenu,
}: WorkspaceFileExplorerProps) {
  const expandedPathsStorageKey = getExpandedPathsStorageKey(chatroomId, workingDir);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    readExpandedPaths(expandedPathsStorageKey)
  );

  const trimmedFilter = filterQuery.trim();
  const { rootNodes, displayNodes, isLoading } = useWorkspaceDirExplorer({
    machineId,
    workingDir,
    searchQuery: isExplorerSearchMode(trimmedFilter) ? trimmedFilter : '',
    filterQuery: isExplorerSearchMode(trimmedFilter) ? '' : filterQuery,
    refreshSignal,
  });

  const filterExpandedDirs = useMemo(() => {
    if (!filterQuery.trim()) return null;
    return collectExpandedDirsForFilter(displayNodes);
  }, [displayNodes, filterQuery]);

  const effectiveExpandedPaths = useMemo(() => {
    if (filterExpandedDirs) {
      return new Set([...expandedPaths, ...filterExpandedDirs]);
    }
    return expandedPaths;
  }, [expandedPaths, filterExpandedDirs]);

  const handleEmptyAreaContextMenu = useCallback(
    (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('[data-tree-node]')) return;
      onEmptyAreaContextMenu?.(event);
    },
    [onEmptyAreaContextMenu]
  );

  useEffect(() => {
    if (!revealPath) return;
    const parts = revealPath.split('/').filter(Boolean);
    if (parts.length <= 1) return;
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join('/');
        if (!next.has(dirPath)) {
          next.add(dirPath);
          changed = true;
        }
      }
      if (changed) {
        writeExpandedPaths(expandedPathsStorageKey, next);
      }
      return next;
    });
  }, [revealPath, expandedPathsStorageKey]);

  const handleToggle = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        writeExpandedPaths(expandedPathsStorageKey, next);
        return next;
      });
    },
    [expandedPathsStorageKey]
  );

  useEffect(() => {
    setExpandedPaths(readExpandedPaths(expandedPathsStorageKey));
  }, [expandedPathsStorageKey]);

  if (isLoading) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 text-chatroom-text-muted text-xs"
        onContextMenu={onEmptyAreaContextMenu}
      >
        <ChatroomLoader size="sm" />
        Loading files…
      </div>
    );
  }

  if (rootNodes.length === 0) {
    return (
      <div
        className="px-4 py-8 text-center text-chatroom-text-muted text-xs"
        onContextMenu={onEmptyAreaContextMenu}
      >
        No files found. Ensure the workspace daemon is running.
      </div>
    );
  }

  if (displayNodes.length === 0 && filterQuery.trim()) {
    return (
      <div
        className="px-4 py-8 text-center text-chatroom-text-muted text-xs"
        onContextMenu={onEmptyAreaContextMenu}
      >
        No files match &ldquo;{filterQuery.trim()}&rdquo;
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 py-1" onContextMenu={handleEmptyAreaContextMenu}>
      <WorkspaceFileExplorerVirtualizedTree
        displayNodes={displayNodes}
        expandedPaths={effectiveExpandedPaths}
        selectedPath={selectedPath}
        dropHighlightPath={dropHighlightPath}
        scrollToPath={revealPath || selectedPath}
        loadingDirs={EMPTY_LOADING_DIRS}
        onToggle={handleToggle}
        onFileSelect={onFileSelect}
        onFileDoubleClick={onFileDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        height="100%"
      />
    </div>
  );
});
