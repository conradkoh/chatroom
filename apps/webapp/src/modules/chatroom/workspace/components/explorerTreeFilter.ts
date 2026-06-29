/** Shared tree filter helpers for workspace file explorer views. */

export interface ExplorerTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children: ExplorerTreeNode[];
}

/** Filter tree nodes by filename substring (case-insensitive). Prunes empty directories. */
export function filterExplorerTreeNodes(
  nodes: ExplorerTreeNode[],
  query: string
): ExplorerTreeNode[] {
  const trimmed = query.trim();
  if (!trimmed) return nodes;

  const lowerFilter = trimmed.toLowerCase();

  function filterNode(node: ExplorerTreeNode): ExplorerTreeNode | null {
    if (node.type === 'file') {
      return node.name.toLowerCase().includes(lowerFilter) ? node : null;
    }

    const filteredChildren = node.children
      .map(filterNode)
      .filter((n): n is ExplorerTreeNode => n !== null);

    if (filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  }

  return nodes.map(filterNode).filter((n): n is ExplorerTreeNode => n !== null);
}

/** Collect all directory paths in a tree so filtered results stay expanded. */
export function collectExpandedDirsForFilter(nodes: ExplorerTreeNode[]): Set<string> {
  const dirs = new Set<string>();

  function walk(node: ExplorerTreeNode) {
    if (node.type === 'directory') {
      dirs.add(node.path);
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  for (const node of nodes) {
    walk(node);
  }

  return dirs;
}
