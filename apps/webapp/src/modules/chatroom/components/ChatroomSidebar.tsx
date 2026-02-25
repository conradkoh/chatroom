'use client';

import { ChevronDown, MessageSquare, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { memo, useMemo, useState } from 'react';

import { useChatroomListing, type ChatroomWithStatus } from '../context/ChatroomListingContext';

// Status indicator colors - using squares per theme guidelines
const getStatusIndicatorClasses = (chatStatus: ChatroomWithStatus['chatStatus']) => {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
  switch (chatStatus) {
    case 'working':
      return `${base} bg-chatroom-status-info`;
    case 'active':
      return `${base} bg-chatroom-status-success`;
    case 'idle':
    case 'completed':
    default:
      return `${base} bg-chatroom-text-muted opacity-40`;
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
      className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-all duration-100 border-b border-chatroom-border ${
        isActive
          ? 'bg-chatroom-bg-hover border-l-2 border-l-chatroom-accent'
          : 'border-l-2 border-l-transparent hover:bg-chatroom-bg-hover hover:border-l-chatroom-border'
      }`}
      onClick={() => onSelect(chatroom._id)}
    >
      {/* Status indicator - square per theme guidelines */}
      <span className={getStatusIndicatorClasses(chatroom.chatStatus)} />

      {/* Name - uppercase per design system, matching AgentPanel styling */}
      <span className="text-xs font-bold uppercase tracking-wide truncate text-chatroom-text-primary flex-1">
        {displayName}
      </span>

      {/* Favorite star indicator */}
      {chatroom.isFavorite && (
        <Star size={10} className="text-yellow-500 flex-shrink-0" fill="currentColor" />
      )}

      {/* Unread indicator - square per theme guidelines */}
      {chatroom.hasUnread && <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />}
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
 *
 * Sections:
 * - Active: Chatrooms with chatStatus 'working' or 'active' (agents present and engaged)
 * - Recent: Top 5 most recently active non-active chatrooms
 * - Completed: Collapsible section for completed chatrooms
 *
 * Favorites are indicated by a star icon on the chatroom item rather than a separate section.
 */
export const ChatroomSidebar = memo(function ChatroomSidebar({
  activeChatroomId,
}: ChatroomSidebarProps) {
  const router = useRouter();
  const { chatrooms, isLoading } = useChatroomListing();
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Compute sections
  const { activeChatrooms, recent, completed } = useMemo(() => {
    if (!chatrooms) return { activeChatrooms: [], recent: [], completed: [] };

    // Completed chatrooms
    const completedChatrooms = chatrooms.filter((c) => c.chatStatus === 'completed');

    // Active chatrooms: agents present and engaged (working or active status)
    const engagedChatrooms = chatrooms.filter(
      (c) => c.chatStatus === 'working' || c.chatStatus === 'active'
    );

    // Recent: Top 5 by lastActivityAt, excluding active and completed chatrooms
    const engagedIds = new Set(engagedChatrooms.map((c) => c._id));
    const remainingChatrooms = chatrooms.filter(
      (c) => !engagedIds.has(c._id) && c.chatStatus !== 'completed'
    );
    const sortedByActivity = [...remainingChatrooms].sort((a, b) => {
      const aTime = a.lastActivityAt || a._creationTime;
      const bTime = b.lastActivityAt || b._creationTime;
      return bTime - aTime;
    });
    const recentChatrooms = sortedByActivity.slice(0, 5);

    return {
      activeChatrooms: engagedChatrooms,
      recent: recentChatrooms,
      completed: completedChatrooms,
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
    <div className="chatroom-root flex flex-col w-full h-full overflow-hidden bg-chatroom-bg-surface">
      {/* Header - consistent with AgentPanel */}
      <div className="flex items-center justify-between h-14 px-4 border-b-2 border-chatroom-border">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatrooms
        </div>
      </div>
      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* Active Section - chatrooms with agents present and engaged */}
        {activeChatrooms.length > 0 && (
          <>
            <div className="px-3 py-2 flex items-center gap-1.5 bg-chatroom-bg-tertiary">
              <span className="w-1.5 h-1.5 bg-chatroom-status-success flex-shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                Active
              </span>
            </div>
            {activeChatrooms.map((chatroom) => (
              <ChatroomSidebarItem
                key={chatroom._id}
                chatroom={chatroom}
                isActive={chatroom._id === activeChatroomId}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}

        {/* Recent Section */}
        {recent.length > 0 && (
          <>
            <div
              className={`px-3 py-2 flex items-center gap-1.5 bg-chatroom-bg-tertiary ${activeChatrooms.length > 0 ? 'border-t border-chatroom-border' : ''}`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                Recent
              </span>
            </div>
            {recent.map((chatroom) => (
              <ChatroomSidebarItem
                key={chatroom._id}
                chatroom={chatroom}
                isActive={chatroom._id === activeChatroomId}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}

        {/* Completed Section - Collapsible */}
        {completed.length > 0 && (
          <>
            <button
              className="w-full px-3 py-2 bg-chatroom-bg-tertiary border-t border-chatroom-border flex items-center justify-between hover:bg-chatroom-bg-hover"
              onClick={() => setCompletedExpanded(!completedExpanded)}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
                Completed ({completed.length})
              </span>
              <ChevronDown
                className={`w-3 h-3 text-chatroom-text-muted transition-transform ${
                  completedExpanded ? 'rotate-180' : ''
                }`}
              />
            </button>
            {completedExpanded &&
              completed.map((chatroom) => (
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
