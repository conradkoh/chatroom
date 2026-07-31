'use client';

/**
 * useChatroomTimelineFeedData — data layer for ChatroomTimelineFeed.
 *
 * Owns role-filtered timeline message fetch and handoff notifications.
 * The feed component handles virtualizer/scroll only.
 */

import { useMemo } from 'react';

import { useFilteredMessagesByRole } from './useFilteredMessagesByRole';
import { useHandoffNotification } from './useHandoffNotification';
import { mapMessageToTimelineEvent } from '../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../timeline/types';

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
  const timeline = useRoleFilteredTimelineSource(chatroomId, senderRoleFilter);

  const messagesForNotify = useMemo(() => timeline.events.map((e) => e.message), [timeline.events]);
  useHandoffNotification(messagesForNotify, chatroomId);

  return {
    events: timeline.events,
    isLoading: timeline.isLoading,
    hasMoreOlder: timeline.hasMoreOlder,
    isLoadingOlder: timeline.isLoadingOlder,
    loadOlderEvents: timeline.loadOlderEvents,
    purgeToInitialWindow: timeline.purgeToInitialWindow,
  };
}
