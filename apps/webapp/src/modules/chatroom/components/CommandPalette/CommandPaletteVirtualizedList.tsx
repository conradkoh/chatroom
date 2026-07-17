'use client';

import { useCallback } from 'react';

import { VirtualizedScrollList } from '../virtual-list';
import type { CommandPaletteRow } from './commandPaletteRows';
import {
  COMMAND_PALETTE_HEADING_ROW_HEIGHT,
  COMMAND_PALETTE_ITEM_ROW_HEIGHT,
} from './commandPaletteRows';
import type { CommandItem } from './types';

import { CommandItem as CommandItemUI } from '@/components/ui/command';

interface CommandPaletteVirtualizedListProps {
  rows: CommandPaletteRow[];
  onSelect: (cmd: CommandItem) => void;
  renderCommandItemContent: (command: CommandItem) => React.ReactNode;
}

const LIST_HEIGHT = 244;

export function CommandPaletteVirtualizedList({
  rows,
  onSelect,
  renderCommandItemContent,
}: CommandPaletteVirtualizedListProps) {
  const estimateSize = useCallback(
    (_index: number, row: CommandPaletteRow) =>
      row.type === 'heading' ? COMMAND_PALETTE_HEADING_ROW_HEIGHT : COMMAND_PALETTE_ITEM_ROW_HEIGHT,
    []
  );

  const getItemKey = useCallback((_index: number, row: CommandPaletteRow) => row.id, []);

  const renderItem = useCallback(
    (row: CommandPaletteRow) => {
      if (row.type === 'heading') {
        return (
          <div className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
            {row.label}
          </div>
        );
      }
      const command = row.command;
      return (
        <CommandItemUI
          key={command.id}
          value={command.label}
          keywords={command.keywords}
          onSelect={() => onSelect(command)}
          className="flex flex-row items-center gap-2 rounded-none cursor-pointer text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary"
        >
          {renderCommandItemContent(command)}
        </CommandItemUI>
      );
    },
    [onSelect, renderCommandItemContent]
  );

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[244px]">
        <span className="text-chatroom-text-muted text-xs font-bold uppercase tracking-wider">
          No commands found.
        </span>
      </div>
    );
  }

  return (
    <VirtualizedScrollList
      items={rows}
      height={LIST_HEIGHT}
      estimateSize={estimateSize}
      getItemKey={getItemKey}
      renderItem={renderItem}
    />
  );
}
