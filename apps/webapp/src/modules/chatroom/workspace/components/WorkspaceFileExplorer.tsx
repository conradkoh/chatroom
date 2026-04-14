'use client';

import type { FileTree, FileTreeEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { FileTypeIcon } from '../../components/FileSelector/fileIcons';
import { useFileTree } from '../hooks/useFileTree';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A node in the hierarchical tree (built from flat FileTreeEntry[]) */
interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: TreeNode[];
}

interface WorkspaceFileExplorerProps {
  chatroomId?: string;
  machineId: string;
  workingDir: string;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  /** When set, auto-expand tree to reveal this file path */
  revealPath?: string | null;
}

// ─── Tree Building ────────────────────────────────────────────────────────────

function buildTree(entries: FileTreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'directory', children: [] };

  for (const entry of entries) {
    const parts = entry.path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      if (isLast) {
        // Leaf node
        current.children.push({
          name: part,
          path: entry.path,
          type: entry.type,
          children: [],
        });
      } else {
        // Intermediate directory — find or create
        let child = current.children.find((c) => c.name === part && c.type === 'directory');
        if (!child) {
          child = {
            name: part,
            path: parts.slice(0, i + 1).join('/'),
            type: 'directory',
            children: [],
          };
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  return sortNodes(root.children);
}

/** Sort: directories first, then files. Both alphabetically. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => ({
      ...n,
      children: n.type === 'directory' ? sortNodes(n.children) : n.children,
    }))
    .sort((a, b) => {
      if (a.type === 'directory' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

// ─── Tree Node Component ──────────────────────────────────────────────────────

const TreeNodeItem = memo(function TreeNodeItem({
  node,
  depth,
  expandedPaths,
  onToggle,
  onFileSelect,
  onFileDoubleClick,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isDirectory = node.type === 'directory';
  const paddingLeft = 12 + depth * 16;

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
        className={cn(
          'w-full flex items-center gap-1.5 py-[3px] pr-2 text-left text-sm',
          'text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary',
          'transition-colors duration-75 cursor-pointer select-none'
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={node.path}
      >
        {/* Expand / collapse chevron for directories */}
        {isDirectory ? (
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {isExpanded ? (
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
              onToggle={onToggle}
              onFileSelect={onFileSelect}
              onFileDoubleClick={onFileDoubleClick}
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
  onFileSelect,
  onFileDoubleClick,
  revealPath,
}: WorkspaceFileExplorerProps) {
  const expandedPathsStorageKey = getExpandedPathsStorageKey(chatroomId, workingDir);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    readExpandedPaths(expandedPathsStorageKey)
  );

  // Restore saved state when chatroom or workingDir changes
  useEffect(() => {
    setExpandedPaths(readExpandedPaths(expandedPathsStorageKey));
  }, [expandedPathsStorageKey]);

  // Fetch file tree reactively (uses cached data from backend, handles decompression)
  const treeResult = useFileTree({ machineId, workingDir });

  // Note: No auto-refresh on mount. Tree refresh is triggered on-demand
  // via the refresh button in FileExplorerPanel.

  // Parse tree JSON into hierarchical nodes
  const treeNodes = useMemo<TreeNode[]>(() => {
    if (!treeResult?.treeJson) return [];
    try {
      const parsed: FileTree = JSON.parse(treeResult.treeJson);
      return buildTree(parsed.entries ?? []);
    } catch {
      return [];
    }
  }, [treeResult?.treeJson]);

  // Auto-expand tree to reveal a specific file path
  useEffect(() => {
    if (!revealPath) return;
    const parts = revealPath.split('/').filter(Boolean);
    if (parts.length <= 1) return; // no parent dirs to expand
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      // Expand all parent directories
      for (let i = 1; i < parts.length; i++) {
        next.add(parts.slice(0, i).join('/'));
      }
      writeExpandedPaths(expandedPathsStorageKey, next);
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

  // Loading state
  if (treeResult === undefined) {
    return (
      <div className="flex items-center justify-center py-8 text-chatroom-text-muted text-xs">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Loading files…
      </div>
    );
  }

  // Empty state
  if (treeNodes.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-chatroom-text-muted text-xs">
        No files found. Ensure the workspace daemon is running.
      </div>
    );
  }

  return (
    <div className="py-1">
      {treeNodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          expandedPaths={expandedPaths}
          onToggle={handleToggle}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
        />
      ))}
    </div>
  );
});
