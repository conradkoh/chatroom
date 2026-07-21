'use client';

/**
 * useChatroomTimelineFeedData — data layer for ChatroomTimelineFeed.
 *
 * Owns timeline message fetch (via useChatroomTimeline or useFilteredMessagesByRole),
 * handoff notifications, and event-stream Convex queries. The feed component handles
 * virtualizer/scroll only.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useMemo, useState } from 'react';

import { useChatroomTimeline, type UseChatroomTimelineResult } from './useChatroomTimeline';
import { useFilteredMessagesByRole } from './useFilteredMessagesByRole';
import { useHandoffNotification } from './useHandoffNotification';
import { mapMessageToTimelineEvent } from '../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../timeline/types';
import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

const noop = () => {};

type TimelineFeedSource = Pick<
  UseChatroomTimelineResult,
  | 'events'
  | 'isLoading'
  | 'hasMoreOlder'
  | 'isLoadingOlder'
  | 'loadOlderEvents'
  | 'removeMessagesForTask'
  | 'purgeToInitialWindow'
>;

function useRoleFilteredTimelineSource(
  chatroomId: string,
  senderRole: string,
  enabled: boolean
): TimelineFeedSource {
  const filteredTimeline = useFilteredMessagesByRole(chatroomId, senderRole, enabled);

  const events: TimelineEvent[] = useMemo(() => {
    if (!enabled) return [];
    // Role query returns newest-first; timeline feed expects chronological order.
    return [...filteredTimeline.messages].reverse().map(mapMessageToTimelineEvent);
  }, [enabled, filteredTimeline.messages]);

  return {
    events,
    isLoading: filteredTimeline.isLoading,
    hasMoreOlder: filteredTimeline.canLoadMore,
    isLoadingOlder: filteredTimeline.isLoadingMore,
    loadOlderEvents: filteredTimeline.loadMore,
    removeMessagesForTask: noop,
    purgeToInitialWindow: noop,
  };
}

export function useChatroomTimelineFeedData(
  chatroomId: string,
  senderRoleFilter: string | null = null
) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const isFiltered = senderRoleFilter !== null;

  const mainTimeline = useChatroomTimeline(chatroomId, !isFiltered);
  const filteredTimeline = useRoleFilteredTimelineSource(
    chatroomId,
    senderRoleFilter ?? '',
    isFiltered
  );
  const timeline = isFiltered ? filteredTimeline : mainTimeline;

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
    removeMessagesForTask: timeline.removeMessagesForTask,
    purgeToInitialWindow: timeline.purgeToInitialWindow,
    isEventStreamOpen,
    setIsEventStreamOpen,
    latestEvent,
    eventsPaginated,
  };
}
