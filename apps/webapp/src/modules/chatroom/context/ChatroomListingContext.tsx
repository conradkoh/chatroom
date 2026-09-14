'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { ChatroomStatus } from '@workspace/shared/domain/chatroom-status';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Base chatroom data shared by listing surfaces. Status is subscribed per chatroom. */
export interface ChatroomListingItem {
  _id: string;
  _creationTime: number;
  status: ChatroomStatus;
  name?: string;
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  lastActivityAt?: number;
  isFavorite: boolean;
  hasUnread: boolean;
  hasUnreadHandoff: boolean;
}

/** @deprecated Use ChatroomListingItem. */
export type ChatroomWithStatus = ChatroomListingItem;

// ─── Context ──────────────────────────────────────────────────────────────────

interface ChatroomListingContextValue {
  chatrooms: ChatroomWithStatus[] | undefined;
  isLoading: boolean;
}

const ChatroomListingContext = createContext<ChatroomListingContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Provider that fetches chatroom listing data using three focused subscriptions:
 *
 * 1. `listByUser`                    — base chatroom rows (sorted, lightweight)
 * 2. `listFavoriteIds`               — favorited chatroom IDs
 * 3. `listUnreadStatus`              — per-chatroom unread indicator
 * Status updates are delivered by the chatroom-scoped useChatroomStatus hook.
 */
export function ChatroomListingProvider({ children }: { children: ReactNode }) {
  // 1. Base chatroom data — lightweight, invalidated only by chatroom changes
  const baseChatrooms = useSessionQuery(api.chatrooms.listByUser);

  // 2. Favorites — re-fires only when favorites change
  const favoriteIds = useSessionQuery(api.chatrooms.listFavoriteIds);

  // 3. Unread status — re-fires when messages or read cursors change
  const unreadStatus = useSessionQuery(api.chatrooms.listUnreadStatus);

  // Merge listing subscriptions. Chatroom status is intentionally separate so one status change
  // does not rebuild every listing item.
  const chatrooms = useMemo<ChatroomWithStatus[] | undefined>(() => {
    if (baseChatrooms === undefined || favoriteIds === undefined || unreadStatus === undefined) {
      return undefined;
    }

    const favoriteSet = new Set(favoriteIds);
    const unreadMap = new Map(unreadStatus.map((u) => [u.chatroomId, u.hasUnread]));
    const unreadHandoffMap = new Map(
      unreadStatus.map((u) => [u.chatroomId, u.hasUnreadHandoff ?? false])
    );
    return baseChatrooms.map((chatroom) => {
      return {
        ...chatroom,
        isFavorite: favoriteSet.has(chatroom._id),
        hasUnread: unreadMap.get(chatroom._id) ?? false,
        hasUnreadHandoff: unreadHandoffMap.get(chatroom._id) ?? false,
      };
    });
  }, [baseChatrooms, favoriteIds, unreadStatus]);

  const value = useMemo(
    () => ({
      chatrooms,
      isLoading: chatrooms === undefined,
    }),
    [chatrooms]
  );

  return (
    <ChatroomListingContext.Provider value={value}>{children}</ChatroomListingContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook to access chatroom listing data.
 * Must be used within a ChatroomListingProvider.
 *
 * Returns:
 * - chatrooms: Array of chatrooms with base, favorite, unread, and handoff data
 * - isLoading: True while any subscription is still loading
 */
export function useChatroomListing() {
  const context = useContext(ChatroomListingContext);
  if (!context) {
    throw new Error('useChatroomListing must be used within ChatroomListingProvider');
  }
  return context;
}
