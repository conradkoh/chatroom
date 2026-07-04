import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files';

import { isPathPendingDelete } from '@/modules/chatroom/workspace/hooks/pendingOptimisticDeletePaths';

/** Minimum query length to switch explorer from client-side filter to server file search. */
// fallow-ignore-next-line unused-export
export const MIN_FILE_SEARCH_QUERY_LENGTH = 2;

/** Explorer uses server search when trimmed query meets this threshold. */
export function isExplorerSearchMode(query: string): boolean {
  return query.trim().length >= MIN_FILE_SEARCH_QUERY_LENGTH;
}

/** File search API accepts empty query (Cmd+P listing) or queries >= MIN length. */
export function isFileSearchQueryActive(query: string): boolean {
  const trimmed = query.trim();
  return trimmed === '' || trimmed.length >= MIN_FILE_SEARCH_QUERY_LENGTH;
}

export interface ExplorerTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: ExplorerTreeNode[];
}

export function dirEntriesToNodes(entries: DirListingEntry[]): ExplorerTreeNode[] {
  return entries
    .filter((e) => !isPathPendingDelete(e.path))
    .map((e) => ({
      name: e.name,
      path: e.path,
      type: e.type,
      children: [],
    }));
}

// fallow-ignore-next-line complexity code-duplication
export function sortExplorerNodes(nodes: ExplorerTreeNode[]): ExplorerTreeNode[] {
  return (
    nodes
      .map((n) => ({
        ...n,
        children: n.type === 'directory' ? sortExplorerNodes(n.children) : [],
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
export function searchEntriesToNodes(
  entries: { path: string; type: 'file' }[]
): ExplorerTreeNode[] {
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

  return sortExplorerNodes(root.children);
}
