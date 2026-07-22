'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useCallback } from 'react';

import { VirtualizedScrollList } from '../virtual-list';
import type { CommandPaletteRow } from './commandPaletteRows';
import {
  COMMAND_PALETTE_HEADING_ROW_HEIGHT,
  COMMAND_PALETTE_ITEM_ROW_HEIGHT,
  COMMAND_PALETTE_ITEM_WITH_DETAIL_ROW_HEIGHT,
} from './commandPaletteRows';
import type { CommandItem } from './types';

import { cn } from '@/lib/utils';
import { CommandItem as CommandItemUI } from '@/components/ui/command';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface CommandPaletteVirtualizedListProps {
  rows: CommandPaletteRow[];
  onSelect: (cmd: CommandItem) => void;
  renderCommandItemContent: (command: CommandItem) => React.ReactNode;
  scrollResetKey?: string;
  isBlacklisted?: (id: string) => boolean;
  onBlacklist?: (id: string) => void;
  onUnblacklist?: (id: string) => void;
}

const LIST_HEIGHT = 244;

export function CommandPaletteVirtualizedList({
  rows,
  onSelect,
  renderCommandItemContent,
  scrollResetKey,
  isBlacklisted,
  onBlacklist,
  onUnblacklist,
}: CommandPaletteVirtualizedListProps) {
  const estimateSize = useCallback((_index: number, row: CommandPaletteRow) => {
    if (row.type === 'heading') return COMMAND_PALETTE_HEADING_ROW_HEIGHT;
    if (row.command.detail) return COMMAND_PALETTE_ITEM_WITH_DETAIL_ROW_HEIGHT;
    return COMMAND_PALETTE_ITEM_ROW_HEIGHT;
  }, []);

  const getItemKey = useCallback((_index: number, row: CommandPaletteRow) => row.id, []);

  const renderItem = useCallback(
    (row: CommandPaletteRow) => {
      if (row.type === 'heading') {
        return (
          <div
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted box-border overflow-hidden"
            style={{ height: COMMAND_PALETTE_HEADING_ROW_HEIGHT }}
          >
            {row.label}
          </div>
        );
      }
      const command = row.command;
      const item = (
        <CommandItemUI
          key={command.id}
          value={command.label}
          keywords={command.keywords}
          onSelect={() => onSelect(command)}
          className={cn(
            'flex flex-row items-center gap-2 rounded-none cursor-pointer text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary box-border overflow-hidden',
            isBlacklisted?.(command.id) && 'opacity-50'
          )}
          style={{
            height: command.detail
              ? COMMAND_PALETTE_ITEM_WITH_DETAIL_ROW_HEIGHT
              : COMMAND_PALETTE_ITEM_ROW_HEIGHT,
          }}
        >
          {renderCommandItemContent(command)}
        </CommandItemUI>
      );

      if (isBlacklisted && onBlacklist && onUnblacklist) {
        return (
          <ContextMenu modal={false} key={command.id}>
            <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
            <ContextMenuContent className="min-w-[180px] rounded-none">
              {isBlacklisted(command.id) ? (
                <ContextMenuItem
                  onSelect={() => onUnblacklist(command.id)}
                  className="rounded-none"
                >
                  <Eye size={14} />
                  Remove from blacklist
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => onBlacklist(command.id)} className="rounded-none">
                  <EyeOff size={14} />
                  Blacklist
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        );
      }

      return item;
    },
    [onSelect, renderCommandItemContent, isBlacklisted, onBlacklist, onUnblacklist]
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
