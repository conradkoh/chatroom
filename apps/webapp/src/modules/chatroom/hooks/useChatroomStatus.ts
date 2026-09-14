'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useQueries } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { ChatroomStatus } from '../../../domain/entities/chatroom-status';

export interface UseChatroomStatusResult {
  status: ChatroomStatus | undefined;
  isLoading: boolean;
}

/** Canonical status query result used by chatroom-level UI. */
export function useChatroomStatus(chatroomId: string): UseChatroomStatusResult {
  const status = useSessionQuery(api.agents.getChatroomStatus, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  return {
    status: status as ChatroomStatus | undefined,
    isLoading: status === undefined,
  };
}

export interface UseChatroomStatusMapResult {
  statuses: ReadonlyMap<string, ChatroomStatus>;
  isLoading: boolean;
}

/**
 * Loads the canonical status query for a dynamic set of chatrooms. Each ID is a
 * separate reactive subscription, so an update only changes that chatroom's
 * backend query result.
 */
export function useChatroomStatusMap(chatroomIds: readonly string[]): UseChatroomStatusMapResult {
  const [sessionId] = useSessionId();
  const queryIds = useMemo(() => Array.from(new Set(chatroomIds)), [chatroomIds]);
  const queries = useMemo(() => {
    if (!sessionId) return {};
    return Object.fromEntries(
      queryIds.map((chatroomId) => [
        chatroomId,
        {
          query: api.agents.getChatroomStatus,
          args: {
            sessionId,
            chatroomId: chatroomId as Id<'chatroom_rooms'>,
          },
        },
      ])
    );
  }, [queryIds, sessionId]);
  const results = useQueries(queries);

  const statuses = useMemo(() => {
    const next = new Map<string, ChatroomStatus>();
    for (const chatroomId of queryIds) {
      const result = results[chatroomId];
      if (result && !(result instanceof Error)) {
        next.set(chatroomId, result as ChatroomStatus);
      }
    }
    return next;
  }, [queryIds, results]);

  return {
    statuses,
    isLoading: !sessionId || queryIds.some((chatroomId) => results[chatroomId] === undefined),
  };
}
