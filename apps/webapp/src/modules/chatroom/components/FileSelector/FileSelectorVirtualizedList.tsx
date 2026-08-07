'use client';

import { useCallback } from 'react';

import { FileTypeIcon } from './fileIcons';
import {
  FILE_SELECTOR_HEADING_ROW_HEIGHT,
  FILE_SELECTOR_ITEM_ROW_HEIGHT,
  type FileSelectorRow,
} from './fileSelectorRows';
import { VirtualizedScrollList } from '../virtual-list';

import { CommandItem } from '@/components/ui/command';
import { getFileName, getParentDir } from '@/lib/pathUtils';

const LIST_HEIGHT = 196;

interface FileSelectorVirtualizedListProps {
  rows: FileSelectorRow[];
  onSelect: (filePath: string) => void;
  scrollResetKey?: string;
}

export function FileSelectorVirtualizedList({
  rows,
  onSelect,
  scrollResetKey,
}: FileSelectorVirtualizedListProps) {
  const estimateSize = useCallback((_index: number, row: FileSelectorRow) => {
    if (row.type === 'heading') return FILE_SELECTOR_HEADING_ROW_HEIGHT;
    return FILE_SELECTOR_ITEM_ROW_HEIGHT;
  }, []);

  const getItemKey = useCallback((_index: number, row: FileSelectorRow) => row.id, []);

  const renderItem = useCallback(
    (row: FileSelectorRow) => {
      if (row.type === 'heading') {
        return (
          <div
            className="px-2 py-1.5 text-sm font-medium text-chatroom-text-muted box-border overflow-hidden"
            style={{ height: FILE_SELECTOR_HEADING_ROW_HEIGHT }}
            cmdk-group-heading=""
          >
            {row.label}
          </div>
        );
      }
      const { path } = row;
      const value = row.isRecent ? `recent:${path}` : path;
      return (
        <CommandItem
          key={row.id}
          value={value}
          keywords={[getFileName(path)]}
          onSelect={() => onSelect(path)}
          className="flex flex-row items-center gap-2 rounded-none cursor-pointer px-3 py-1 min-h-[28px] text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover box-border overflow-hidden"
          style={{ height: FILE_SELECTOR_ITEM_ROW_HEIGHT }}
        >
          <FileTypeIcon path={path} className="h-4 w-4 shrink-0 text-chatroom-text-muted" />
          <span className="text-sm font-medium truncate flex-1">{getFileName(path)}</span>
          {getParentDir(path) && (
            <span className="text-sm text-chatroom-text-muted truncate max-w-[50%]">
              {getParentDir(path)}
            </span>
          )}
        </CommandItem>
      );
    },
    [onSelect]
  );

  return (
    <VirtualizedScrollList
      items={rows}
      height={LIST_HEIGHT}
      estimateSize={estimateSize}
      getItemKey={getItemKey}
      renderItem={renderItem}
      scrollResetKey={scrollResetKey}
    />
  );
}
