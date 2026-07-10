import type { FileTreeEntry } from '@workspace/backend/src/domain/entities/workspace-files';

import { sortExplorerNodes, type ExplorerTreeNode } from './explorer-tree';

import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';
import { isPathPendingDelete } from '@/modules/chatroom/workspace/hooks/pendingOptimisticDeletePaths';

/** Matches CLI file-tree-partition FileTreeShardPayload */
export type FileTreeShardPayload = {
  entries: FileTreeEntry[];
  scannedAt: number;
  rootDir: string;
};

export function mergeFileTreeShardPayloads(payloads: FileTreeShardPayload[]): FileTreeEntry[] {
  const byPath = new Map<string, FileTreeEntry>();
  for (const payload of payloads) {
    for (const entry of payload.entries) {
      byPath.set(entry.path, entry);
    }
  }
  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function getBaseName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

// fallow-ignore-next-line unused-export
export function fileTreeEntryToFileEntry(entry: FileTreeEntry): FileEntry {
  return {
    path: entry.path,
    type: entry.type,
    ...(entry.size !== undefined ? { size: entry.size } : {}),
    ...(entry.modifiedAt !== undefined ? { modifiedAt: entry.modifiedAt } : {}),
  };
}

export function fileTreeEntriesToFileEntries(entries: FileTreeEntry[]): FileEntry[] {
  return entries.map(fileTreeEntryToFileEntry);
}

/** Build hierarchical explorer nodes from flat file-tree entries. */
// fallow-ignore-next-line complexity
export function fileTreeEntriesToExplorerNodes(entries: FileTreeEntry[]): ExplorerTreeNode[] {
  const root: ExplorerTreeNode = { name: '', path: '', type: 'directory', children: [] };
  const nodeByPath = new Map<string, ExplorerTreeNode>();

  const getOrCreate = (path: string, type: 'file' | 'directory'): ExplorerTreeNode => {
    let node = nodeByPath.get(path);
    if (!node) {
      node = { name: getBaseName(path), path, type, children: [] };
      nodeByPath.set(path, node);
    }
    return node;
  };

  for (const entry of entries) {
    if (isPathPendingDelete(entry.path)) continue;
    const parts = entry.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join('/');

      if (isLast) {
        const node = getOrCreate(childPath, entry.type);
        if (!current.children.some((c) => c.path === childPath)) {
          current.children.push(node);
        }
      } else {
        let child = current.children.find((c) => c.path === childPath && c.type === 'directory');
        if (!child) {
          child = getOrCreate(childPath, 'directory');
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  return sortExplorerNodes(root.children);
}

/** Client-side filter for Cmd+P / @ (case-insensitive substring on path). */
export function filterFileTreeEntries(entries: FileTreeEntry[], query: string): FileTreeEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return entries;
  const lower = trimmed.toLowerCase();
  return entries.filter((entry) => entry.path.toLowerCase().includes(lower));
}
