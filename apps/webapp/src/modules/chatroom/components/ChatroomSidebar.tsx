'use client';

import { ChevronDown, MessageSquare, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { memo, useMemo, useState } from 'react';

import { useChatroomListing, type ChatroomWithStatus } from '../context/ChatroomListingContext';

// Status indicator colors - using squares per theme guidelines
const getStatusIndicatorClasses = (chatStatus: ChatroomWithStatus['chatStatus']) => {
  const base = 'w-1.5 h-1.5 flex-shrink-0';
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
      className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-all duration-100 border-l-2 ${
        isActive
          ? 'bg-chatroom-bg-hover border-chatroom-accent'
          : 'border-transparent hover:bg-chatroom-bg-hover hover:border-chatroom-border'
      }`}
      onClick={() => onSelect(chatroom._id)}
    >
      {/* Status indicator - square per theme guidelines */}
      <span className={getStatusIndicatorClasses(chatroom.chatStatus)} />

      {/* Name only - color square is the signal, no redundant status text */}
      <span className="text-[11px] font-bold uppercase tracking-wide truncate text-chatroom-text-primary flex-1">
        {displayName}
      </span>

      {/* Unread indicator - square per theme guidelines */}
      {chatroom.hasUnread && <span className="w-1.5 h-1.5 bg-chatroom-accent flex-shrink-0" />}
    </button>
  );
});

interface SectionHeaderProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

const SectionHeader = memo(function SectionHeader({
  children,
  icon,
  className = '',
}: SectionHeaderProps) {
  return (
    <div
      className={`px-3 py-1.5 border-b-2 border-chatroom-border flex items-center gap-1.5 ${className}`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        {children}
      </span>
    </div>
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
 * - Favorites: Chatrooms marked as favorite
 * - Recent: Top 5 most recently active chatrooms
 * - Completed: Collapsible section for completed chatrooms
 */
export const ChatroomSidebar = memo(function ChatroomSidebar({
  activeChatroomId,
}: ChatroomSidebarProps) {
  const router = useRouter();
  const { chatrooms, isLoading } = useChatroomListing();
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // Compute sections
  const { favorites, recent, completed } = useMemo(() => {
    if (!chatrooms) return { favorites: [], recent: [], completed: [] };

    // Completed chatrooms
    const completedChatrooms = chatrooms.filter((c) => c.chatStatus === 'completed');

    // Active chatrooms (non-completed)
    const activeChatrooms = chatrooms.filter((c) => c.chatStatus !== 'completed');

    // Favorites (active only)
    const favoriteChatrooms = activeChatrooms.filter((c) => c.isFavorite);

    // Recent: Top 5 by lastActivityAt, excluding favorites to avoid duplication
    const nonFavoriteActive = activeChatrooms.filter((c) => !c.isFavorite);
    const sortedByActivity = [...nonFavoriteActive].sort((a, b) => {
      const aTime = a.lastActivityAt || a._creationTime;
      const bTime = b.lastActivityAt || b._creationTime;
      return bTime - aTime;
    });
    const recentChatrooms = sortedByActivity.slice(0, 5);

    return {
      favorites: favoriteChatrooms,
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b-2 border-chatroom-border flex-shrink-0">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatrooms
        </h2>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto">
        {/* Favorites Section */}
        {favorites.length > 0 && (
          <>
            <SectionHeader
              icon={<Star size={10} className="text-yellow-500" fill="currentColor" />}
            >
              Favorites
            </SectionHeader>
            {favorites.map((chatroom) => (
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
            <SectionHeader className={favorites.length > 0 ? 'mt-2' : ''}>Recent</SectionHeader>
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
              className="w-full px-3 py-1.5 mt-2 border-t-2 border-chatroom-border flex items-center justify-between hover:bg-chatroom-bg-hover"
              onClick={() => setCompletedExpanded(!completedExpanded)}
            >
              <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
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
