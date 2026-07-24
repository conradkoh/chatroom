'use client';

import { useCallback, useMemo } from 'react';

import { flattenVisibleExplorerNodes, type ExplorerFlatRow } from './explorerTreeFlatten';
import { ExplorerTreeRow } from './ExplorerTreeRow';
import { EXPLORER_TREE_ROW_HEIGHT } from './explorerTreeRowHeight';
import { VirtualizedScrollList } from '../../components/virtual-list';
import type { ExplorerTreeNode } from '../files/explorer-tree';

interface WorkspaceFileExplorerVirtualizedTreeProps {
  displayNodes: ExplorerTreeNode[];
  expandedPaths: Set<string>;
  selectedPath: string | null;
  dropHighlightPath?: string | null;
  scrollToPath?: string | null;
  loadingDirs: Set<string>;
  onToggle: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  onNodeContextMenu?: (node: ExplorerTreeNode, event: React.MouseEvent) => void;
  height?: number | string;
}

export function WorkspaceFileExplorerVirtualizedTree({
  displayNodes,
  expandedPaths,
  selectedPath,
  dropHighlightPath = null,
  scrollToPath,
  loadingDirs,
  onToggle,
  onFileSelect,
  onFileDoubleClick,
  onNodeContextMenu,
  height,
}: WorkspaceFileExplorerVirtualizedTreeProps) {
  const flatRows = useMemo(
    () => flattenVisibleExplorerNodes(displayNodes, expandedPaths),
    [displayNodes, expandedPaths]
  );

  const estimateSize = useCallback(() => EXPLORER_TREE_ROW_HEIGHT, []);
  const getItemKey = useCallback((_i: number, row: ExplorerFlatRow) => row.node.path, []);

  const renderItem = useCallback(
    (row: ExplorerFlatRow) => (
      <ExplorerTreeRow
        node={row.node}
        depth={row.depth}
        isExpanded={expandedPaths.has(row.node.path)}
        isSelected={row.node.path === selectedPath}
        isDropHighlighted={dropHighlightPath !== null && row.node.path === dropHighlightPath}
        isLoading={loadingDirs.has(row.node.path)}
        onToggle={onToggle}
        onFileSelect={onFileSelect}
        onFileDoubleClick={onFileDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
      />
    ),
    [
      expandedPaths,
      selectedPath,
      dropHighlightPath,
      loadingDirs,
      onToggle,
      onFileSelect,
      onFileDoubleClick,
      onNodeContextMenu,
    ]
  );

  return (
    <VirtualizedScrollList
      items={flatRows}
      height={height ?? '100%'}
      estimateSize={estimateSize}
      getItemKey={getItemKey}
      renderItem={renderItem}
      scrollToItemKey={scrollToPath ?? undefined}
      className="flex-1"
    />
  );
}
