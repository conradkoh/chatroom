'use client';

import { Star } from 'lucide-react';
import { useCallback } from 'react';

import { VirtualizedScrollList } from '../virtual-list';
import type { ChatroomSwitcherRow } from './chatroomSwitcherRows';
import { getChatroomSwitcherKeywords } from './chatroomSwitcherRows';
import {
  COMMAND_DIALOG_HEADING_ROW_HEIGHT,
  COMMAND_DIALOG_ITEM_ROW_HEIGHT,
  COMMAND_DIALOG_LIST_HEIGHT,
} from '../shared/commandDialogListConstants';

import { CommandItem } from '@/components/ui/command';
import { getChatStatusIndicatorClasses } from '@/modules/chatroom/utils/chatStatusDisplay';
import { getChatroomDisplayName } from '@/modules/chatroom/viewModels/chatroomViewModel';

interface ChatroomSwitcherVirtualizedListProps {
  rows: ChatroomSwitcherRow[];
  onSelect: (chatroomId: string) => void;
  scrollResetKey?: string;
}

export function ChatroomSwitcherVirtualizedList({
  rows,
  onSelect,
  scrollResetKey,
}: ChatroomSwitcherVirtualizedListProps) {
  const estimateSize = useCallback((_index: number, row: ChatroomSwitcherRow) => {
    if (row.type === 'heading') return COMMAND_DIALOG_HEADING_ROW_HEIGHT;
    return COMMAND_DIALOG_ITEM_ROW_HEIGHT;
  }, []);

  const getItemKey = useCallback((_index: number, row: ChatroomSwitcherRow) => row.id, []);

  const renderItem = useCallback(
    (row: ChatroomSwitcherRow) => {
      if (row.type === 'heading') {
        return (
          <div
            className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted box-border overflow-hidden"
            style={{ height: COMMAND_DIALOG_HEADING_ROW_HEIGHT }}
          >
            {row.label}
          </div>
        );
      }
      const chatroom = row.chatroom;
      return (
        <CommandItem
          key={chatroom._id}
          value={chatroom._id}
          keywords={getChatroomSwitcherKeywords(chatroom)}
          onSelect={() => onSelect(chatroom._id)}
          className="flex flex-row items-center gap-2 rounded-none cursor-pointer text-chatroom-text-primary hover:bg-chatroom-bg-hover data-[selected=true]:bg-chatroom-bg-hover data-[selected=true]:text-chatroom-text-primary box-border overflow-hidden"
          style={{ height: COMMAND_DIALOG_ITEM_ROW_HEIGHT }}
        >
          <span className={getChatStatusIndicatorClasses(chatroom.chatStatus)} />
          <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary flex-1 truncate">
            {getChatroomDisplayName(chatroom)}
          </span>
          {chatroom.isFavorite && (
            <Star size={10} className="text-yellow-500 flex-shrink-0" fill="currentColor" />
          )}
          {chatroom.hasUnread && <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />}
        </CommandItem>
      );
    },
    [onSelect]
  );

  return (
    <VirtualizedScrollList
      items={rows}
      height={COMMAND_DIALOG_LIST_HEIGHT}
      estimateSize={estimateSize}
      getItemKey={getItemKey}
      renderItem={renderItem}
      scrollResetKey={scrollResetKey}
    />
  );
}
