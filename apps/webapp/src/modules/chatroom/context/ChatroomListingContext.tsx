'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import {
  type ChatroomPresenceEntry,
  usePresenceForChatrooms,
} from '../hooks/usePresenceForChatrooms';
import { deriveChatStatus } from '../utils/deriveChatStatus';
import type { ChatStatus } from '../utils/deriveChatStatus';

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

// ─── Agent building ───────────────────────────────────────────────────────────

/**
 * Build the agent list for a chatroom from teamRoles (excluding the user),
 * merging presence fields. `isAlive` mirrors getTeamLifecycle / the agent panel
 * (`isAgentAlive(spawnedAgentPid)` via `aliveRoles`) — NOT the daemon-gated
 * `runningRoles` — so spawned working agents don't show grey idle.
 */
function buildAgentsForChatroom(
  chatroom: { _id: string; teamRoles?: string[] },
  presenceByRoomRole: Map<string, ChatroomPresenceEntry>,
  aliveRoles: string[]
): Agent[] {
  return (chatroom.teamRoles ?? [])
    .filter((role) => role.toLowerCase() !== 'user')
    .map((role) => {
      const presence = presenceByRoomRole.get(`${chatroom._id}:${role.toLowerCase()}`);
      return {
        role,
        lastSeenAt: presence?.lastSeenAt ?? null,
        lastSeenAction: presence?.lastSeenAction ?? null,
        lastStatus: presence?.lastStatus ?? null,
        lastDesiredState: presence?.lastDesiredState ?? null,
        isAlive: aliveRoles.some((r) => r.toLowerCase() === role.toLowerCase()),
      };
    });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * Provider that fetches chatroom listing data using six focused subscriptions:
 *
 * 1. `listByUser`                    — base chatroom rows (sorted, lightweight)
 * 2. `getPresenceForChatroom` (×N)   — per-chatroom presence; heartbeats scoped to one room
 * 3. `listFavoriteIds`               — favorited chatroom IDs
 * 4. `listUnreadStatus`              — per-chatroom unread indicator
 * 5. `listAgentOverview`             — remote agent running state per chatroom
 * 6. `listActiveEnhancerWork`        — active enhancer job/task per chatroom
 *
 * Splitting into six subscription groups means a participant heartbeat (every 30s)
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

  // 6. Active enhancer work — re-fires when enhancer jobs or tasks transition
  const enhancerWorkStatus = useSessionQuery(api.chatrooms.listActiveEnhancerWork);

  // Merge the six subscriptions into a single ChatroomWithStatus[] for consumers
  const chatrooms = useMemo<ChatroomWithStatus[] | undefined>(() => {
    // Wait for all subscriptions to resolve before returning data
    if (
      baseChatrooms === undefined ||
      presenceData === undefined ||
      favoriteIds === undefined ||
      unreadStatus === undefined ||
      remoteAgentStatusData === undefined ||
      enhancerWorkStatus === undefined
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
    const enhancerWorkMap = new Map(
      enhancerWorkStatus.map((e) => [e.chatroomId, e.hasActiveEnhancerWork])
    );

    // Index presence by (chatroomId, role) so agents built from teamRoles can
    // pick up their presence fields (lastSeenAt, lastStatus, ...) when present.
    const presenceByRoomRole = new Map<string, ChatroomPresenceEntry>();
    for (const p of presenceData) {
      presenceByRoomRole.set(`${p.chatroomId}:${p.role.toLowerCase()}`, p);
    }

    return baseChatrooms.map((chatroom) => {
      const aliveRoles = remoteAgentStatusMap.get(chatroom._id)?.aliveRoles ?? [];
      const agents = buildAgentsForChatroom(chatroom, presenceByRoomRole, aliveRoles);

      const chatStatus = deriveChatStatus(chatroom.status, agents, {
        hasActiveEnhancerWork: enhancerWorkMap.get(chatroom._id) ?? false,
      });

      return {
        ...chatroom,
        agents,
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
    presenceData,
    favoriteIds,
    unreadStatus,
    remoteAgentStatusData,
    enhancerWorkStatus,
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

/** Lookup pre-computed chatStatus from listing context (SSOT — includes enhancer work). Exported for unit tests. */
// fallow-ignore-next-line unused-export
export function selectChatroomChatStatus(
  chatrooms: ChatroomWithStatus[] | undefined,
  chatroomId: string
): ChatStatus {
  return chatrooms?.find((c) => c._id === chatroomId)?.chatStatus ?? 'idle';
}

/**
 * Returns the chatroom-level status indicator value for a single room.
 * Must be used within ChatroomListingProvider.
 * Same value as listing page, sidebar, and switcher.
 */
export function useChatroomChatStatus(chatroomId: string): ChatStatus {
  const { chatrooms } = useChatroomListing();
  return useMemo(() => selectChatroomChatStatus(chatrooms, chatroomId), [chatrooms, chatroomId]);
}
