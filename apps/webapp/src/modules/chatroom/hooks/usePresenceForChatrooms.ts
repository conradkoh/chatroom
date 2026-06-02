/**
 * Per-chatroom participant presence subscriptions.
 *
 * Each chatroom uses getPresenceForChatroom so a heartbeat in chatroom A does not
 * invalidate presence reads for chatrooms B–Z (unlike listParticipantPresence).
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useQueries } from 'convex/react';
import { useMemo } from 'react';

export type ChatroomPresenceEntry = {
  chatroomId: string;
  role: string;
  lastSeenAt: number | null;
  lastSeenAction: string | null;
  lastStatus: string | null;
  lastDesiredState: string | null;
};

/**
 * Subscribes to getPresenceForChatroom for each chatroom id.
 * Returns undefined while any subscription is loading.
 */
export function usePresenceForChatrooms(
  chatroomIds: string[]
): ChatroomPresenceEntry[] | undefined {
  const [sessionId] = useSessionId();

  const queryRequests = useMemo(() => {
    if (!sessionId || chatroomIds.length === 0) {
      return {};
    }
    const requests: Record<
      string,
      {
        query: typeof api.chatrooms.getPresenceForChatroom;
        args: { sessionId: string; chatroomId: Id<'chatroom_rooms'> };
      }
    > = {};
    for (const chatroomId of chatroomIds) {
      requests[chatroomId] = {
        query: api.chatrooms.getPresenceForChatroom,
        args: {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        },
      };
    }
    return requests;
  }, [sessionId, chatroomIds]);

  const resultsByChatroom = useQueries(queryRequests);

  return useMemo(() => {
    if (!sessionId) {
      return undefined;
    }
    if (chatroomIds.length === 0) {
      return [];
    }

    const flat: ChatroomPresenceEntry[] = [];
    for (const chatroomId of chatroomIds) {
      const rows = resultsByChatroom[chatroomId];
      if (rows === undefined) {
        return undefined;
      }
      if (rows instanceof Error) {
        continue;
      }
      for (const row of rows) {
        flat.push({
          chatroomId: row.chatroomId,
          role: row.role,
          lastSeenAt: row.lastSeenAt,
          lastSeenAction: row.lastSeenAction,
          lastStatus: row.lastStatus,
          lastDesiredState: row.lastDesiredState,
        });
      }
    }
    return flat;
  }, [sessionId, chatroomIds, resultsByChatroom]);
}
