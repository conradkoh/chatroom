'use client';

import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { memo, useCallback, type MouseEvent, type Ref } from 'react';

import { EXPLORER_TREE_ROW_HEIGHT } from './explorerTreeRowHeight';
import { FileTypeIcon } from '../../components/FileSelector/fileIcons';
import type { ExplorerTreeNode } from '../files/explorer-tree';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { cn } from '@/lib/utils';

export interface ExplorerTreeRowProps {
  node: ExplorerTreeNode;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isLoading: boolean;
  onToggle: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  onNodeContextMenu?: (node: ExplorerTreeNode, event: MouseEvent) => void;
  rowRef?: Ref<HTMLButtonElement>;
}

// fallow-ignore-next-line complexity
export const ExplorerTreeRow = memo(function ExplorerTreeRow({
  node,
  depth,
  isExpanded,
  isSelected,
  isLoading,
  onToggle,
  onFileSelect,
  onFileDoubleClick,
  onNodeContextMenu,
  rowRef,
}: ExplorerTreeRowProps) {
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
    <button
      data-tree-node
      ref={rowRef}
      className={cn(
        'w-full flex items-center gap-1.5 pr-2 text-left text-sm box-border overflow-hidden',
        isSelected
          ? 'bg-chatroom-accent/10 text-chatroom-accent'
          : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary',
        'transition-colors duration-75 cursor-pointer select-none'
      )}
      style={{ paddingLeft, height: EXPLORER_TREE_ROW_HEIGHT }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(event) => onNodeContextMenu?.(node, event)}
      title={node.path}
    >
      {isDirectory ? (
        <span className="w-4 h-4 flex items-center justify-center shrink-0">
          {isLoading ? (
            <ChatroomLoader size="sm" />
          ) : isExpanded ? (
            <ChevronDown size={14} className="text-chatroom-text-muted" />
          ) : (
            <ChevronRight size={14} className="text-chatroom-text-muted" />
          )}
        </span>
      ) : (
        <span className="w-4 h-4 shrink-0" />
      )}

      {isDirectory ? (
        isExpanded ? (
          <FolderOpen size={16} className="text-chatroom-accent shrink-0" />
        ) : (
          <Folder size={16} className="text-chatroom-accent shrink-0" />
        )
      ) : (
        <FileTypeIcon path={node.name} className="w-4 h-4 shrink-0 text-chatroom-text-muted" />
      )}

      <span className="truncate text-[13px]">{node.name}</span>
    </button>
  );
});
