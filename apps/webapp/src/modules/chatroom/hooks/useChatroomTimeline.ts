'use client';

/**
 * useChatroomTimeline — paginated chatroom history as linear timeline events.
 *
 * Reuses subscribeLatestMessages + imperative load-older from useMessages,
 * then maps each row to a TimelineEvent for the virtualized timeline feed.
 */

import { useMemo } from 'react';

import { mapMessageToTimelineEvent } from '../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../timeline/types';

import { useMessages } from './useMessages';

export interface UseChatroomTimelineResult {
  events: TimelineEvent[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderEvents: () => void;
  purgeOldMessages: (viewportTopIndex: number) => void;
}

export function useChatroomTimeline(chatroomId: string): UseChatroomTimelineResult {
  const {
    messages,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderMessages,
    purgeOldMessages,
  } = useMessages(chatroomId);

  const events = useMemo(
    () => messages.map(mapMessageToTimelineEvent),
    [messages]
  );

  return {
    events,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderEvents: loadOlderMessages,
    purgeOldMessages,
  };
}
