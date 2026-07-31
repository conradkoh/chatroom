'use client';

/**
 * useChatroomTimelineFeedData — data layer for ChatroomTimelineFeed.
 *
 * Owns role-filtered timeline message fetch, handoff notifications, and
 * event-stream Convex queries. The feed component handles virtualizer/scroll only.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useMemo, useState } from 'react';

import { useFilteredMessagesByRole } from './useFilteredMessagesByRole';
import { useHandoffNotification } from './useHandoffNotification';
import { mapMessageToTimelineEvent } from '../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../timeline/types';
import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

const noop = () => {};

function useRoleFilteredTimelineSource(chatroomId: string, senderRole: string) {
  const filteredTimeline = useFilteredMessagesByRole(chatroomId, senderRole, true);

  const events: TimelineEvent[] = useMemo(
    () =>
      // Role query returns newest-first; timeline feed expects chronological order.
      [...filteredTimeline.messages].reverse().map(mapMessageToTimelineEvent),
    [filteredTimeline.messages]
  );

  return {
    events,
    isLoading: filteredTimeline.isLoading,
    hasMoreOlder: filteredTimeline.canLoadMore,
    isLoadingOlder: filteredTimeline.isLoadingMore,
    loadOlderEvents: filteredTimeline.loadMore,
    purgeToInitialWindow: noop,
  };
}

export function useChatroomTimelineFeedData(chatroomId: string, senderRoleFilter: string) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const timeline = useRoleFilteredTimelineSource(chatroomId, senderRoleFilter);

  const messagesForNotify = useMemo(() => timeline.events.map((e) => e.message), [timeline.events]);
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
    events: timeline.events,
    isLoading: timeline.isLoading,
    hasMoreOlder: timeline.hasMoreOlder,
    isLoadingOlder: timeline.isLoadingOlder,
    loadOlderEvents: timeline.loadOlderEvents,
    purgeToInitialWindow: timeline.purgeToInitialWindow,
    isEventStreamOpen,
    setIsEventStreamOpen,
    latestEvent,
    eventsPaginated,
  };
}
