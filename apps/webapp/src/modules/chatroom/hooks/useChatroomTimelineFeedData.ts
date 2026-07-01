'use client';

/**
 * useChatroomTimelineFeedData — data layer for ChatroomTimelineFeed.
 *
 * Owns timeline message fetch (via useChatroomTimeline), handoff notifications,
 * and event-stream Convex queries. The feed component handles virtualizer/scroll only.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useMemo, useState } from 'react';

import { useChatroomTimeline } from './useChatroomTimeline';
import { useHandoffNotification } from './useHandoffNotification';
import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

export function useChatroomTimelineFeedData(chatroomId: string) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const {
    events,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderEvents,
    removeMessagesForTask,
  } = useChatroomTimeline(chatroomId);

  const messagesForNotify = useMemo(() => events.map((e) => e.message), [events]);
  useHandoffNotification(messagesForNotify, chatroomId);

  const [isEventStreamOpen, setIsEventStreamOpen] = useState(false);

  const latestEventTicker = useSessionQuery(api.events.listLatestEvents, {
    chatroomId: typedChatroomId,
    limit: 1,
  });

  const [eventSessionId] = useSessionId();
  const eventsPaginated = usePaginatedQuery(
    api.events.listLatestEventsPaginated,
    isEventStreamOpen && eventSessionId
      ? { chatroomId: typedChatroomId, sessionId: eventSessionId }
      : 'skip',
    { initialNumItems: 20 }
  );

  const latestEvent: EventStreamEvent | null =
    (latestEventTicker as EventStreamEvent[] | undefined)?.[0] ?? null;

  return {
    events,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderEvents,
    removeMessagesForTask,
    isEventStreamOpen,
    setIsEventStreamOpen,
    latestEvent,
    eventsPaginated,
  };
}
