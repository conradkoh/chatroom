'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  type ChatroomPresenceEntry,
  usePresenceForChatrooms,
} from '../hooks/usePresenceForChatrooms';
import { deriveChatStatus } from '../utils/deriveChatStatus';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A presence row enriched with the agent's live running state.
 *
 * Derived from the canonical {@link ChatroomPresenceEntry} (single source of
 * truth) rather than re-declaring the presence fields — only the frontend-only
 * `isAlive` flag is added, and `chatroomId` is dropped (rows are already grouped
 * by chatroom here).
 */
export type Agent = Omit<ChatroomPresenceEntry, 'chatroomId'> & {
  isAlive: boolean;
};

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
  chatStatus: 'working' | 'active' | 'transitioning' | 'idle' | 'completed';
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
 * 2. `getPresenceForChatroom` (×N)   — per-chatroom presence; heartbeats scoped to one room
 * 3. `listFavoriteIds`               — favorited chatroom IDs
 * 4. `listUnreadStatus`              — per-chatroom unread indicator
 * 5. `listAgentOverview`             — remote agent running state per chatroom
 *
 * Splitting into five subscription groups means a participant heartbeat (every 30s)
 * only re-runs presence for that chatroom, not the entire listing.
 */
export function ChatroomListingProvider({ children }: { children: ReactNode }) {
  // 1. Base chatroom data — lightweight, invalidated only by chatroom changes
  const baseChatrooms = useSessionQuery(api.chatrooms.listByUser);

  const chatroomIds = useMemo(
    () => (baseChatrooms ?? []).map((c) => c._id as string),
    [baseChatrooms]
  );

  // 2. Participant presence — one subscription per chatroom (scoped invalidation)
  const presenceData = usePresenceForChatrooms(chatroomIds);

  // 3. Favorites — re-fires only when favorites change
  const favoriteIds = useSessionQuery(api.chatrooms.listFavoriteIds);

  // 4. Unread status — re-fires when messages or read cursors change
  const unreadStatus = useSessionQuery(api.chatrooms.listUnreadStatus);

  // 5. Remote agent running status — re-fires when any machine spawnedAgentPid changes
  const remoteAgentStatusData = useSessionQuery(api.machines.listAgentOverview);

  // Merge the five subscriptions into a single ChatroomWithStatus[] for consumers
  const chatrooms = useMemo<ChatroomWithStatus[] | undefined>(() => {
    // Wait for all subscriptions to resolve before returning data
    if (
      baseChatrooms === undefined ||
      presenceData === undefined ||
      favoriteIds === undefined ||
      unreadStatus === undefined ||
      remoteAgentStatusData === undefined
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

    // Group presence by chatroomId
    const presenceByRoom = new Map<string, Agent[]>();
    for (const p of presenceData) {
      const runningRoles = remoteAgentStatusMap.get(p.chatroomId)?.runningRoles ?? [];
      const existing = presenceByRoom.get(p.chatroomId) ?? [];
      existing.push({
        role: p.role,
        lastSeenAt: p.lastSeenAt,
        lastSeenAction: p.lastSeenAction,
        lastStatus: p.lastStatus,
        lastDesiredState: p.lastDesiredState,
        isAlive: runningRoles.some((r) => r.toLowerCase() === p.role.toLowerCase()),
      });
      presenceByRoom.set(p.chatroomId, existing);
    }

    return baseChatrooms.map((chatroom) => {
      const agents = presenceByRoom.get(chatroom._id) ?? [];

      const chatStatus = deriveChatStatus(chatroom.status, agents);

      return {
        ...chatroom,
        agents,
        chatStatus,
        isFavorite: favoriteSet.has(chatroom._id),
        hasUnread: unreadMap.get(chatroom._id) ?? false,
        hasUnreadHandoff: unreadHandoffMap.get(chatroom._id) ?? false,
        remoteAgentStatus: (remoteAgentStatusMap.get(chatroom._id)?.agentStatus ?? 'none') as
          | 'running'
          | 'stopped'
          | 'none',
        runningRoles: remoteAgentStatusMap.get(chatroom._id)?.runningRoles ?? [],
        runningAgentConfigs: remoteAgentStatusMap.get(chatroom._id)?.runningAgents ?? [],
      } as ChatroomWithStatus;
    });
  }, [baseChatrooms, presenceData, favoriteIds, unreadStatus, remoteAgentStatusData]);

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
