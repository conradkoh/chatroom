'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { CheckCircle, MoreVertical } from 'lucide-react';
import React, { memo, useCallback, useState } from 'react';

import { ChatroomFavoriteButton } from './ChatroomFavoriteButton';
import { chatroomDisplayName, isChatroomShownInTab, type TabType } from './chatroomSelectorModel';
import { ChatroomStatusIndicator } from './ChatroomStatusIndicator';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';
import { useChatroomStatus } from '../../hooks/useChatroomStatus';
import { createChatroomSelectKeyDown } from '../chatroom-select-keydown';
import { LifecycleConfirmDialog } from '../LifecycleConfirmDialog';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ChatroomCardProps {
  chatroom: ChatroomWithStatus;
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}

/** Archive menu. Hidden for completed chatrooms, which have nothing left to archive. */
function ChatroomCardActions({
  showMenu,
  onArchive,
}: {
  showMenu: boolean;
  onArchive: (e: React.MouseEvent) => void;
}) {
  if (!showMenu) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className="w-7 h-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-all duration-100"
        onClick={(e) => e.stopPropagation()}
        aria-label="Chatroom actions"
      >
        <MoreVertical size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        <DropdownMenuItem onClick={onArchive}>
          <CheckCircle size={14} className="mr-2" />
          Archive Chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Live activity and state for one chatroom. Both are undefined until the status arrives. */
function useCardStatus(chatroomId: string) {
  const { status } = useChatroomStatus(chatroomId);
  return { activityStatus: status?.activityStatus, state: status?.state };
}

/** One chatroom in the grid. Renders nothing when the chatroom belongs to the other tab. */
export const ChatroomCard = memo(function ChatroomCard({
  chatroom,
  onSelect,
  activeTab,
}: ChatroomCardProps) {
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const toggleFavorite = useSessionMutation(api.chatrooms.toggleFavorite);
  const { activityStatus, state } = useCardStatus(chatroom._id);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation(); // Prevent card click
      try {
        await toggleFavorite({
          chatroomId: chatroom._id as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
      }
    },
    [toggleFavorite, chatroom._id]
  );

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    setArchiveDialogOpen(true);
  }, []);

  if (!isChatroomShownInTab(chatroom, state, activeTab)) {
    return null;
  }

  return (
    <>
      <div className="relative">
        <div
          role="button"
          tabIndex={0}
          className="bg-chatroom-bg-surface border-2 border-chatroom-border p-2 text-left transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong cursor-pointer w-full"
          onClick={() => onSelect(chatroom._id)}
          onKeyDown={createChatroomSelectKeyDown(() => onSelect(chatroom._id))}
          data-chat-status={activityStatus ?? 'loading'}
        >
          {/* Card Main */}
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
              <ChatroomStatusIndicator activityStatus={activityStatus} />
              <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary truncate">
                {chatroomDisplayName(chatroom)}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ChatroomFavoriteButton
                isFavorite={chatroom.isFavorite}
                onClick={handleToggleFavorite}
              />
              <ChatroomCardActions showMenu={state !== 'completed'} onArchive={handleArchive} />
            </div>
          </div>
        </div>
      </div>

      <LifecycleConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={setArchiveDialogOpen}
        chatroomId={chatroom._id as Id<'chatroom_rooms'>}
        action="archive"
      />
    </>
  );
});
