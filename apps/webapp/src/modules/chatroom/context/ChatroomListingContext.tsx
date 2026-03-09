'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { usePresenceTick, isAgentPresent } from '../hooks/usePresenceTick';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Agent {
  role: string;
  lastSeenAt: number | null;
  lastSeenAction: string | null;
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
  chatStatus: 'working' | 'active' | 'idle' | 'completed';
  isFavorite: boolean;
  hasUnread: boolean;
  remoteAgentStatus: 'running' | 'stopped' | 'none';
  runningRoles: string[];
  runningAgentConfigs: Array<{ machineId: string; role: string }>;
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
 * 2. `listParticipantPresence`       — agent presence; re-fires on heartbeats (30s)
 * 3. `listFavoriteIds`               — favorited chatroom IDs
 * 4. `listUnreadStatus`              — per-chatroom unread indicator
 * 5. `listAgentOverview`             — remote agent running state per chatroom
 *
 * Splitting into five subscriptions means a participant heartbeat (every 30s)
 * only re-runs `listParticipantPresence`, not the entire bundle.
 */
export function ChatroomListingProvider({ children }: { children: ReactNode }) {
  // 1. Base chatroom data — lightweight, invalidated only by chatroom changes
  const baseChatrooms = useSessionQuery(api.chatrooms.listByUser);

  // 2. Participant presence — re-fires on every agent heartbeat (30s)
  const presenceData = useSessionQuery(api.chatrooms.listParticipantPresence);

  // 3. Favorites — re-fires only when favorites change
  const favoriteIds = useSessionQuery(api.chatrooms.listFavoriteIds);

  // 4. Unread status — re-fires when messages or read cursors change
  const unreadStatus = useSessionQuery(api.chatrooms.listUnreadStatus);

  // 5. Remote agent running status — re-fires when any machine spawnedAgentPid changes
  const remoteAgentStatusData = useSessionQuery(api.machines.listAgentOverview);

  // Tick every 30s to keep time-based `chatStatus` fresh without DB writes
  const tick = usePresenceTick();

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
    const remoteAgentStatusMap = new Map(
      remoteAgentStatusData.map((entry) => [entry.chatroomId as string, entry])
    );

    // Group presence by chatroomId
    const presenceByRoom = new Map<string, Agent[]>();
    for (const p of presenceData) {
      const existing = presenceByRoom.get(p.chatroomId) ?? [];
      existing.push({ role: p.role, lastSeenAt: p.lastSeenAt, lastSeenAction: p.lastSeenAction });
      presenceByRoom.set(p.chatroomId, existing);
    }

    const now = Date.now();

    return baseChatrooms.map((chatroom) => {
      const agents = presenceByRoom.get(chatroom._id) ?? [];

      // Derive chatStatus from presence and chatroom status
      type ChatStatus = 'working' | 'active' | 'idle' | 'completed';
      let chatStatus: ChatStatus;
      if (chatroom.status === 'completed') {
        chatStatus = 'completed';
      } else {
        const onlineAgents = agents.filter((a) => isAgentPresent(a.lastSeenAt, now));
        if (onlineAgents.length === 0) {
          chatStatus = 'idle';
        } else {
          // 'working': any online agent is actively doing something (not waiting for next task)
          const hasWorking = onlineAgents.some(
            (a) => a.lastSeenAction && a.lastSeenAction !== 'get-next-task:started'
          );
          chatStatus = hasWorking ? 'working' : 'active';
        }
      }

      return {
        ...chatroom,
        agents,
        chatStatus,
        isFavorite: favoriteSet.has(chatroom._id),
        hasUnread: unreadMap.get(chatroom._id) ?? false,
        remoteAgentStatus: (remoteAgentStatusMap.get(chatroom._id)?.agentStatus ?? 'none') as 'running' | 'stopped' | 'none',
        runningRoles: remoteAgentStatusMap.get(chatroom._id)?.runningRoles ?? [],
        runningAgentConfigs: remoteAgentStatusMap.get(chatroom._id)?.runningAgents ?? [],
      } as ChatroomWithStatus;
    });
  }, [baseChatrooms, presenceData, favoriteIds, unreadStatus, remoteAgentStatusData, tick]);

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
