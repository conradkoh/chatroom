'use client';

import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

import {
  collectExpandedDirsForFilter,
  filterExplorerTreeNodes,
  type ExplorerTreeNode,
} from './explorerTreeFilter';
import { FileTypeIcon } from '../../components/FileSelector/fileIcons';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { cn } from '@/lib/utils';
import { DirListingWatcher, useWorkspaceDirExplorer } from '@/modules/chatroom/workspace/files';
import { isExplorerSearchMode } from '@/modules/chatroom/workspace/files/explorer-tree';
import { useDirListingWatch } from '@/modules/chatroom/workspace/files/useDirListingWatch';

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
  onNodeContextMenu?: (node: ExplorerTreeNode, event: MouseEvent) => void;
  onEmptyAreaContextMenu?: (event: MouseEvent) => void;
}

// ─── Tree Node Component ──────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
const TreeNodeItem = memo(function TreeNodeItem({
  node,
  depth,
  expandedPaths,
  selectedPath,
  onToggle,
  onFileSelect,
  onFileDoubleClick,
  onNodeContextMenu,
  nodeRefs,
  loadingDirs,
}: {
  node: ExplorerTreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  onNodeContextMenu?: (node: ExplorerTreeNode, event: MouseEvent) => void;
  nodeRefs: Map<string, HTMLElement>;
  loadingDirs: Set<string>;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isDirectory = node.type === 'directory';
  const isSelected = node.path === selectedPath;
  const paddingLeft = 12 + depth * 16;

  const refCallback = useCallback(
    (el: HTMLButtonElement | null) => {
      if (el) {
        nodeRefs.set(node.path, el);
      }
    },
    [node.path, nodeRefs]
  );

  const handleClick = useCallback(() => {
    if (isDirectory) {
      onToggle(node.path);
    } else {
      onFileSelect?.(node.path);
    }
  }, [isDirectory, node.path, onToggle, onFileSelect]);

  const handleDoubleClick = useCallback(() => {
    if (!isDirectory) {
      onFileDoubleClick?.(node.path);
    }
  }, [isDirectory, node.path, onFileDoubleClick]);

  return (
    <>
      <button
        data-tree-node
        ref={refCallback}
        className={cn(
          'w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-sm',
          isSelected
            ? 'bg-chatroom-accent/10 text-chatroom-accent'
            : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary',
          'transition-colors duration-75 cursor-pointer select-none'
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(event) => onNodeContextMenu?.(node, event)}
        title={node.path}
      >
        {/* Expand / collapse chevron for directories */}
        {isDirectory ? (
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {loadingDirs.has(node.path) ? (
              <ChatroomLoader size="sm" />
            ) : isExpanded ? (
              <ChevronDown size={14} className="text-chatroom-text-muted" />
            ) : (
              <ChevronRight size={14} className="text-chatroom-text-muted" />
            )}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" /> /* spacer for files */
        )}

        {/* Icon */}
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen size={16} className="text-chatroom-accent shrink-0" />
          ) : (
            <Folder size={16} className="text-chatroom-accent shrink-0" />
          )
        ) : (
          <FileTypeIcon path={node.name} className="w-4 h-4 shrink-0 text-chatroom-text-muted" />
        )}

        {/* Name */}
        <span className="truncate text-[13px]">{node.name}</span>
      </button>

      {/* Children */}
      {isDirectory && isExpanded && node.children.length > 0 && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onFileSelect={onFileSelect}
              onFileDoubleClick={onFileDoubleClick}
              onNodeContextMenu={onNodeContextMenu}
              nodeRefs={nodeRefs}
              loadingDirs={loadingDirs}
            />
          ))}
        </div>
      )}
    </>
  );
});

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
  onNodeContextMenu,
  onEmptyAreaContextMenu,
}: WorkspaceFileExplorerProps) {
  const expandedPathsStorageKey = getExpandedPathsStorageKey(chatroomId, workingDir);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    readExpandedPaths(expandedPathsStorageKey)
  );

  const trimmedFilter = filterQuery.trim();
  const {
    rootNodes,
    loadingDirs,
    requestedDirs,
    loadChildren,
    isLoading,
    isSearchMode,
    refreshToken,
    handleDirUpdate,
  } = useWorkspaceDirExplorer({
    machineId,
    workingDir,
    searchQuery: isExplorerSearchMode(trimmedFilter) ? trimmedFilter : '',
    refreshSignal,
  });

  const displayNodes = useMemo(() => {
    if (isSearchMode) return rootNodes;
    return filterExplorerTreeNodes(rootNodes, filterQuery);
  }, [rootNodes, filterQuery, isSearchMode]);

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

  const activeWatchPaths = useMemo(() => {
    const paths = new Set<string>(['']);
    for (const dirPath of effectiveExpandedPaths) {
      paths.add(dirPath);
    }
    return [...paths].sort((a, b) => a.localeCompare(b));
  }, [effectiveExpandedPaths]);

  useDirListingWatch({
    machineId,
    workingDir,
    activeDirPaths: activeWatchPaths,
  });

  const handleEmptyAreaContextMenu = useCallback(
    (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest('[data-tree-node]')) return;
      onEmptyAreaContextMenu?.(event);
    },
    [onEmptyAreaContextMenu]
  );

  // Auto-expand tree to reveal a specific file path
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
          loadChildren(dirPath);
          changed = true;
        }
      }
      if (changed) {
        writeExpandedPaths(expandedPathsStorageKey, next);
      }
      return next;
    });
  }, [revealPath, expandedPathsStorageKey, loadChildren]);

  // Node ref map for scroll-into-view on selection change
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    nodeRefs.current = new Map();
  }, [displayNodes]);

  // Scroll the selected node into view (after render, when the node's element is mounted)
  const scrollTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const targetPath = revealPath || selectedPath;
    if (!targetPath) return;

    // Clear any pending scroll tick
    if (scrollTickRef.current) {
      clearTimeout(scrollTickRef.current);
    }

    // Defer one tick so the node's ref callback has fired after render
    scrollTickRef.current = setTimeout(() => {
      const el = nodeRefs.current.get(targetPath);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });

    return () => {
      if (scrollTickRef.current) {
        clearTimeout(scrollTickRef.current);
      }
    };
  }, [revealPath, selectedPath]);

  const handleToggle = useCallback(
    (path: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          loadChildren(path);
        }
        writeExpandedPaths(expandedPathsStorageKey, next);
        return next;
      });
    },
    [expandedPathsStorageKey, loadChildren]
  );

  // Restore saved state when chatroom or workingDir changes; load children for expanded dirs
  useEffect(() => {
    const saved = readExpandedPaths(expandedPathsStorageKey);
    setExpandedPaths(saved);
    for (const dirPath of saved) {
      void loadChildren(dirPath);
    }
  }, [expandedPathsStorageKey, loadChildren]);

  // Loading state
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

  // Empty state
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
    <div className="py-1" onContextMenu={handleEmptyAreaContextMenu}>
      {requestedDirs.map((dirPath) => (
        <DirListingWatcher
          key={dirPath}
          machineId={machineId}
          workingDir={workingDir}
          dirPath={dirPath}
          refreshToken={refreshToken}
          onUpdate={handleDirUpdate}
        />
      ))}
      {displayNodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          expandedPaths={effectiveExpandedPaths}
          selectedPath={selectedPath}
          onToggle={handleToggle}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          nodeRefs={nodeRefs.current}
          loadingDirs={loadingDirs}
        />
      ))}
    </div>
  );
});
