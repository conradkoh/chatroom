import type { ExplorerTreeNode } from '../files/explorer-tree';

export interface ExplorerFlatRow {
  node: ExplorerTreeNode;
  depth: number;
}

export function flattenVisibleExplorerNodes(
  nodes: ExplorerTreeNode[],
  expandedPaths: Set<string>,
  depth = 0
): ExplorerFlatRow[] {
  const rows: ExplorerFlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.type === 'directory' && expandedPaths.has(node.path) && node.children.length > 0) {
      rows.push(...flattenVisibleExplorerNodes(node.children, expandedPaths, depth + 1));
    }
  }
  return rows;
}
