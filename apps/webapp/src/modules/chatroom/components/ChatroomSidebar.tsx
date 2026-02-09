'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import React, { memo, useMemo } from 'react';
import { MessageSquare } from 'lucide-react';

import {
  useChatroomListing,
  type ChatroomWithStatus,
} from '../context/ChatroomListingContext';

// Status badge colors - compact version for sidebar
const getStatusDotClasses = (chatStatus: ChatroomWithStatus['chatStatus']) => {
  const base = 'w-2 h-2 rounded-full flex-shrink-0';
  switch (chatStatus) {
    case 'ready':
      return `${base} bg-chatroom-status-success`;
    case 'working':
      return `${base} bg-chatroom-status-info`;
    case 'completed':
      return `${base} bg-chatroom-status-info opacity-50`;
    case 'disconnected':
      return `${base} bg-chatroom-status-error`;
    case 'setup':
      return `${base} bg-chatroom-status-warning`;
    case 'partial':
    default:
      return `${base} bg-chatroom-text-muted`;
  }
};

interface ChatroomSidebarItemProps {
  chatroom: ChatroomWithStatus;
  isActive: boolean;
  onSelect: (chatroomId: string) => void;
}

const ChatroomSidebarItem = memo(function ChatroomSidebarItem({
  chatroom,
  isActive,
  onSelect,
}: ChatroomSidebarItemProps) {
  const displayName = chatroom.name || chatroom.teamName || 'Chatroom';

  return (
    <button
      className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-all duration-100 border-l-2 ${
        isActive
          ? 'bg-chatroom-bg-hover border-chatroom-accent'
          : 'border-transparent hover:bg-chatroom-bg-hover hover:border-chatroom-border'
      }`}
      onClick={() => onSelect(chatroom._id)}
    >
      {/* Status dot */}
      <span className={getStatusDotClasses(chatroom.chatStatus)} />

      {/* Name and info */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wide truncate text-chatroom-text-primary">
          {displayName}
        </div>
        <div className="text-[9px] text-chatroom-text-muted uppercase tracking-wide">
          {chatroom.chatStatus}
        </div>
      </div>

      {/* Unread indicator */}
      {chatroom.hasUnread && (
        <span className="w-2 h-2 rounded-full bg-chatroom-accent flex-shrink-0" />
      )}
    </button>
  );
});

interface ChatroomSidebarProps {
  /** Currently active chatroom ID */
  activeChatroomId?: string;
}

/**
 * Dense sidebar showing all chatrooms with status and unread indicators.
 * Designed for desktop use within the chatroom view to allow quick switching.
 */
export const ChatroomSidebar = memo(function ChatroomSidebar({
  activeChatroomId,
}: ChatroomSidebarProps) {
  const router = useRouter();
  const { chatrooms, isLoading } = useChatroomListing();

  // Split chatrooms into active and completed
  const { activeChatrooms, completedChatrooms } = useMemo(() => {
    if (!chatrooms) return { activeChatrooms: [], completedChatrooms: [] };
    return {
      activeChatrooms: chatrooms.filter((c) => c.chatStatus !== 'completed'),
      completedChatrooms: chatrooms.filter((c) => c.chatStatus === 'completed'),
    };
  }, [chatrooms]);

  const handleSelect = (chatroomId: string) => {
    router.push(`/app/chatroom?id=${chatroomId}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
      </div>
    );
  }

  if (!chatrooms || chatrooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-chatroom-text-muted">
        <MessageSquare size={16} className="mb-2 opacity-50" />
        <span className="text-[10px] uppercase tracking-wide">No chatrooms</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-chatroom-border flex-shrink-0">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatrooms
        </h2>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* Active chatrooms */}
        {activeChatrooms.map((chatroom) => (
          <ChatroomSidebarItem
            key={chatroom._id}
            chatroom={chatroom}
            isActive={chatroom._id === activeChatroomId}
            onSelect={handleSelect}
          />
        ))}

        {/* Completed section */}
        {completedChatrooms.length > 0 && (
          <>
            <div className="px-3 py-1.5 mt-2 border-t border-chatroom-border">
              <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted">
                Completed
              </span>
            </div>
            {completedChatrooms.map((chatroom) => (
              <ChatroomSidebarItem
                key={chatroom._id}
                chatroom={chatroom}
                isActive={chatroom._id === activeChatroomId}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
});
