'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

// Types based on backend response from listByUserWithStatus
export interface Agent {
  role: string;
  status: 'active' | 'waiting';
  effectiveStatus: 'active' | 'waiting' | 'disconnected';
  isExpired: boolean;
  readyUntil?: number;
}

export interface TeamReadiness {
  isReady: boolean;
  missingRoles: string[];
  expiredRoles: string[];
}

export interface ChatroomWithStatus {
  _id: string;
  _creationTime: number;
  status: 'active' | 'completed';
  name?: string;
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  lastActivityAt?: number;
  agents: Agent[];
  chatStatus: 'ready' | 'working' | 'partial' | 'disconnected' | 'setup' | 'completed';
  isFavorite: boolean;
  hasUnread: boolean;
  teamReadiness: TeamReadiness;
}

interface ChatroomListingContextValue {
  chatrooms: ChatroomWithStatus[] | undefined;
  isLoading: boolean;
}

const ChatroomListingContext = createContext<ChatroomListingContextValue | null>(null);

/**
 * Provider that fetches and maintains chatroom listing data with computed statuses.
 * Uses Convex subscriptions which persist across navigations, preventing re-fetches
 * when navigating between chatroom pages.
 */
export function ChatroomListingProvider({ children }: { children: ReactNode }) {
  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;

  // Single query - Convex subscriptions maintain data across navigations
  const chatrooms = useSessionQuery(chatroomApi.chatrooms.listByUserWithStatus) as
    | ChatroomWithStatus[]
    | undefined;

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

/**
 * Hook to access chatroom listing data.
 * Must be used within a ChatroomListingProvider.
 *
 * Returns:
 * - chatrooms: Array of chatrooms with computed agent and chat statuses
 * - isLoading: True while data is being fetched
 */
export function useChatroomListing() {
  const context = useContext(ChatroomListingContext);
  if (!context) {
    throw new Error('useChatroomListing must be used within ChatroomListingProvider');
  }
  return context;
}
