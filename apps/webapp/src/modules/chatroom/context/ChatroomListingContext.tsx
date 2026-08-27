'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import { deriveChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import type { ChatroomStatus } from '@workspace/shared/domain/chatroom-status';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatroomWithStatus {
  _id: string;
  _creationTime: number;
  status: ChatroomStatus;
  name?: string;
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  lastActivityAt?: number;
  chatStatus: ChatroomActivityStatus;
  isFavorite: boolean;
  hasUnread: boolean;
  hasUnreadHandoff: boolean;
  remoteAgentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  runningAgentConfigs: { machineId: string; role: string }[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ChatroomListingContextValue {
  chatrooms: ChatroomWithStatus[] | undefined;
  isLoading: boolean;
}

const ChatroomListingContext = createContext<ChatroomListingContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Provider that fetches chatroom listing data using five focused subscriptions:
 *
 * 1. `listByUser`                    — base chatroom rows (sorted, lightweight)
 * 2. `listFavoriteIds`               — favorited chatroom IDs
 * 3. `listUnreadStatus`              — per-chatroom unread indicator
 * 4. `listAgentOverview`             — remote agent running state per chatroom
 * 5. `listAgentRoleStatusReadModel`  — projected role activity per chatroom
 *
 * Activity updates are delivered through the role-status projection.
 */
export function ChatroomListingProvider({ children }: { children: ReactNode }) {
  // 1. Base chatroom data — lightweight, invalidated only by chatroom changes
  const baseChatrooms = useSessionQuery(api.chatrooms.listByUser);

  // 2. Favorites — re-fires only when favorites change
  const favoriteIds = useSessionQuery(api.chatrooms.listFavoriteIds);

  // 3. Unread status — re-fires when messages or read cursors change
  const unreadStatus = useSessionQuery(api.chatrooms.listUnreadStatus);

  // 4. Remote agent running status — re-fires when any machine spawnedAgentPid changes
  const remoteAgentStatusData = useSessionQuery(api.machines.listAgentOverview);

  // 5. Projected role activity — the source for chatroom activity status
  const agentActivityStatusData = useSessionQuery(api.machines.listAgentRoleStatusReadModel);

  // Merge the five subscriptions into a single ChatroomWithStatus[] for consumers
  const chatrooms = useMemo<ChatroomWithStatus[] | undefined>(() => {
    // Wait for all subscriptions to resolve before returning data
    if (
      baseChatrooms === undefined ||
      favoriteIds === undefined ||
      unreadStatus === undefined ||
      remoteAgentStatusData === undefined ||
      agentActivityStatusData === undefined
    ) {
      return undefined;
    }

    const favoriteSet = new Set(favoriteIds);
    const unreadMap = new Map(unreadStatus.map((u) => [u.chatroomId, u.hasUnread]));
    const unreadHandoffMap = new Map(
      unreadStatus.map((u) => [u.chatroomId, u.hasUnreadHandoff ?? false])
    );
    const remoteAgentStatusMap = new Map(
      remoteAgentStatusData.map((entry) => [entry.chatroomId as string, entry])
    );
    const agentActivityStatusMap = new Map<string, typeof agentActivityStatusData>();
    for (const status of agentActivityStatusData) {
      const chatroomStatuses = agentActivityStatusMap.get(status.chatroomId) ?? [];
      chatroomStatuses.push(status);
      agentActivityStatusMap.set(status.chatroomId, chatroomStatuses);
    }

    return baseChatrooms.map((chatroom) => {
      const chatStatus = deriveChatroomActivityStatus(
        chatroom.status,
        agentActivityStatusMap.get(chatroom._id) ?? []
      );

      return {
        ...chatroom,
        chatStatus,
        isFavorite: favoriteSet.has(chatroom._id),
        hasUnread: unreadMap.get(chatroom._id) ?? false,
        hasUnreadHandoff: unreadHandoffMap.get(chatroom._id) ?? false,
        remoteAgentStatus: (remoteAgentStatusMap.get(chatroom._id)?.agentStatus ?? 'none') as
          'running' | 'stopped' | 'none',
        runningRoles: remoteAgentStatusMap.get(chatroom._id)?.runningRoles ?? [],
        runningAgentConfigs: remoteAgentStatusMap.get(chatroom._id)?.runningAgents ?? [],
      } as ChatroomWithStatus;
    });
  }, [
    baseChatrooms,
    favoriteIds,
    unreadStatus,
    remoteAgentStatusData,
    agentActivityStatusData,
  ]);

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
 * - chatrooms: Array of chatrooms with computed agent and chat statuses
 * - isLoading: True while any subscription is still loading
 */
export function useChatroomListing() {
  const context = useContext(ChatroomListingContext);
  if (!context) {
    throw new Error('useChatroomListing must be used within ChatroomListingProvider');
  }
  return context;
}
