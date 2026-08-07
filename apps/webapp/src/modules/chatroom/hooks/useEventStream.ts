'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import type { EventStreamEvent } from '../viewModels/eventStreamViewModel';

const PAGE_SIZE = 20;

// fallow-ignore-next-line complexity
export function useEventStream(chatroomId: string, enabled = true) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const [sessionId] = useSessionId();

  const paginated = usePaginatedQuery(
    api.events.listLatestEventsPaginated,
    enabled && sessionId ? { chatroomId: typedChatroomId, sessionId } : 'skip',
    { initialNumItems: PAGE_SIZE }
  );

  const events: EventStreamEvent[] = (paginated.results as EventStreamEvent[] | undefined) ?? [];

  const loadMore = useCallback(() => {
    if (paginated.status === 'CanLoadMore') {
      paginated.loadMore(PAGE_SIZE);
    }
  }, [paginated]);

  return {
    events,
    isLoading: paginated.results === undefined || paginated.status === 'LoadingFirstPage',
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore,
  };
}
