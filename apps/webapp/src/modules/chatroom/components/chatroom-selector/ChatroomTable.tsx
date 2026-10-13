'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { CheckCircle, MoreVertical } from 'lucide-react';
import React, { memo, useCallback, useMemo, useState } from 'react';

import { ChatroomFavoriteButton } from './ChatroomFavoriteButton';
import { chatroomDisplayName, isChatroomShownInTab, type TabType } from './chatroomSelectorModel';
import { ChatroomStatusIndicator } from './ChatroomStatusIndicator';
import type { ChatroomWithStatus } from '../../context/ChatroomListingContext';
import { isChatroomCompleted } from '../../viewModels/chatroomViewModel';
import { LifecycleConfirmDialog } from '../LifecycleConfirmDialog';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatroomStatus } from '@/domain/entities/chatroom-status';

/** Stops clicks inside a row cell from also selecting the row. */
function StopClickPropagation({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
      }}
      role="button"
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

function ChatroomTableActions({ onArchive }: { onArchive: (e: React.MouseEvent) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className="w-7 h-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-tertiary transition-all duration-100"
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

interface ChatroomTableRowProps {
  chatroom: ChatroomWithStatus;
  status: ChatroomStatus | undefined;
  onSelect: (chatroomId: string) => void;
  onToggleFavorite: (e: React.MouseEvent, chatroomId: string) => void;
  onArchive: (e: React.MouseEvent, chatroomId: string) => void;
}

function ChatroomTableRow({
  chatroom,
  status,
  onSelect,
  onToggleFavorite,
  onArchive,
}: ChatroomTableRowProps) {
  const canArchive = !isChatroomCompleted(chatroom, status?.state);

  return (
    <div
      role="button"
      tabIndex={0}
      className="grid grid-cols-[32px_1fr_auto_40px] gap-4 px-4 py-3 border-b border-chatroom-border last:border-b-0 hover:bg-chatroom-bg-hover transition-all duration-100 text-left w-full cursor-pointer"
      onClick={() => onSelect(chatroom._id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(chatroom._id);
        }
      }}
    >
      {/* Favorite Star */}
      <StopClickPropagation className="flex items-center justify-center">
        <ChatroomFavoriteButton
          isFavorite={chatroom.isFavorite}
          onClick={(e) => onToggleFavorite(e, chatroom._id)}
        />
      </StopClickPropagation>
      {/* Name */}
      <div className="flex items-center min-w-0">
        <span className="text-xs font-bold uppercase tracking-wide text-chatroom-text-primary truncate">
          {chatroomDisplayName(chatroom)}
        </span>
      </div>
      {/* Status */}
      <div className="flex items-center min-w-[120px]">
        <ChatroomStatusIndicator activityStatus={status?.activityStatus} />
      </div>
      {/* Actions */}
      <StopClickPropagation className="flex items-center justify-center">
        {canArchive && <ChatroomTableActions onArchive={(e) => onArchive(e, chatroom._id)} />}
      </StopClickPropagation>
    </div>
  );
}

interface ChatroomTableProps {
  chatrooms: ChatroomWithStatus[];
  statuses: ReadonlyMap<string, ChatroomStatus>;
  onSelect: (chatroomId: string) => void;
  activeTab: TabType;
}

/**
 * Table view for chatrooms - more compact, data-dense display
 */
export const ChatroomTable = memo(function ChatroomTable({
  chatrooms,
  statuses,
  onSelect,
  activeTab,
}: ChatroomTableProps) {
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [pendingArchiveChatroomId, setPendingArchiveChatroomId] = useState<string | null>(null);
  const toggleFavorite = useSessionMutation(api.chatrooms.toggleFavorite);

  const handleToggleFavorite = useCallback(
    async (e: React.MouseEvent, chatroomId: string) => {
      e.stopPropagation();
      try {
        await toggleFavorite({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        });
      } catch (error) {
        console.error('Failed to toggle favorite:', error);
      }
    },
    [toggleFavorite]
  );

  const handleArchive = useCallback((e: React.MouseEvent, chatroomId: string) => {
    e.stopPropagation();
    setPendingArchiveChatroomId(chatroomId);
    setArchiveDialogOpen(true);
  }, []);

  // Filter chatrooms based on active tab
  const filteredChatrooms = useMemo(
    () =>
      chatrooms.filter((chatroom) =>
        isChatroomShownInTab(chatroom, statuses.get(chatroom._id)?.state, activeTab)
      ),
    [chatrooms, activeTab, statuses]
  );

  if (filteredChatrooms.length === 0) {
    return (
      <div className="text-center py-12 text-chatroom-text-muted">
        No chatrooms found in this tab
      </div>
    );
  }

  return (
    <>
      <div className="border-2 border-chatroom-border overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-[32px_1fr_auto_40px] gap-4 px-4 py-2 bg-chatroom-bg-tertiary border-b-2 border-chatroom-border">
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            Name
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            Status
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted" />
        </div>
        {/* Table Rows */}
        {filteredChatrooms.map((chatroom) => (
          <ChatroomTableRow
            key={chatroom._id}
            chatroom={chatroom}
            status={statuses.get(chatroom._id)}
            onSelect={onSelect}
            onToggleFavorite={handleToggleFavorite}
            onArchive={handleArchive}
          />
        ))}
      </div>

      <LifecycleConfirmDialog
        open={archiveDialogOpen}
        onOpenChange={(open) => {
          setArchiveDialogOpen(open);
          if (!open) setPendingArchiveChatroomId(null);
        }}
        chatroomId={(pendingArchiveChatroomId ?? chatrooms[0]?._id) as Id<'chatroom_rooms'>}
        action="archive"
      />
    </>
  );
});
