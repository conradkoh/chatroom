'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { toMessage } from './useChatroomMessageStore';
import type { Message } from '../types/message';

const PAGE_SIZE = 20;

export function useFilteredUserMessages(chatroomId: string, enabled: boolean) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const [sessionId] = useSessionId();

  const paginated = usePaginatedQuery(
    api.messages.listUserMessagesPaginated,
    enabled && sessionId ? { chatroomId: typedChatroomId, sessionId } : 'skip',
    { initialNumItems: PAGE_SIZE }
  );

  const messages: Message[] = useMemo(
    () => (paginated.results ?? []).map(toMessage),
    [paginated.results]
  );

  return {
    messages,
    isLoading: paginated.status === 'LoadingFirstPage',
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore: () => paginated.loadMore(PAGE_SIZE),
  };
}
