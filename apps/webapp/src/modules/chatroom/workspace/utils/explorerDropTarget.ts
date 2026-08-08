import { getParentDir } from '@/lib/pathUtils';

export type ExplorerDropNodeType = 'file' | 'directory';

export type ExplorerDropTarget = {
  targetDir: string;
  highlightPath: string;
};

/** Resolve the destination directory from a tree row hit during drag-over. */
function resolveExplorerDropTarget(
  path: string,
  nodeType: ExplorerDropNodeType
): ExplorerDropTarget {
  if (nodeType === 'directory') {
    return { targetDir: path, highlightPath: path };
  }
  const parentDir = getParentDir(path);
  return { targetDir: parentDir, highlightPath: parentDir };
}

/** Read drop target metadata from a tree row element, if present. */
// fallow-ignore-next-line complexity
export function readExplorerDropTargetFromElement(
  element: Element | null
): ExplorerDropTarget | null {
  const row = element?.closest('[data-tree-node]');
  if (!row) return null;

  const path = row.getAttribute('data-path');
  const nodeType = row.getAttribute('data-node-type');
  if (!path || (nodeType !== 'file' && nodeType !== 'directory')) return null;

  return resolveExplorerDropTarget(path, nodeType);
}

/** Default drop target when the pointer is not over a tree row. */
export function getExplorerRootDropTarget(): ExplorerDropTarget {
  return { targetDir: '', highlightPath: '' };
}
