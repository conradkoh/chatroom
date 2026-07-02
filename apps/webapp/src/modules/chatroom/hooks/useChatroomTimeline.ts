'use client';

/**
 * useChatroomTimeline — paginated chatroom history as linear timeline events.
 *
 * Maps messages from useChatroomMessageStore to TimelineEvent view models.
 */

import { useMemo } from 'react';

import { useChatroomMessageStore } from './useChatroomMessageStore';
import { mapMessageToTimelineEvent } from '../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../timeline/types';

export interface UseChatroomTimelineResult {
  events: TimelineEvent[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderEvents: () => void;
  removeMessagesForTask: (taskId: string) => void;
}

export function useChatroomTimeline(chatroomId: string): UseChatroomTimelineResult {
  const {
    messages,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderMessages,
    removeMessagesForTask,
  } = useChatroomMessageStore(chatroomId);

  const events = useMemo(() => messages.map(mapMessageToTimelineEvent), [messages]);

  return {
    events,
    isLoading,
    hasMoreOlder,
    isLoadingOlder,
    loadOlderEvents: loadOlderMessages,
    removeMessagesForTask,
  };
}
