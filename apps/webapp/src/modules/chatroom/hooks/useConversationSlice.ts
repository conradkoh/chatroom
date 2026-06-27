'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { toMessage } from './useChatroomMessageStore';
import { mapMessageToTimelineEvent } from '../timeline/mapMessageToTimelineEvent';

const PAGE_SIZE = 30;

export function useConversationSlice(
  chatroomId: string,
  anchorMessageId: Id<'chatroom_messages'> | null
) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const [sessionId] = useSessionId();

  const paginated = usePaginatedQuery(
    api.messages.listConversationSlicePaginated as PaginatedQueryReference,
    anchorMessageId && sessionId
      ? {
          chatroomId: typedChatroomId,
          sessionId,
          anchorMessageId,
        }
      : 'skip',
    { initialNumItems: PAGE_SIZE }
  );

  const events = useMemo(
    () => (paginated.results ?? []).map((m) => mapMessageToTimelineEvent(toMessage(m))),
    [paginated.results]
  );

  return {
    events,
    isLoading: paginated.status === 'LoadingFirstPage',
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore: () => paginated.loadMore(PAGE_SIZE),
  };
}
