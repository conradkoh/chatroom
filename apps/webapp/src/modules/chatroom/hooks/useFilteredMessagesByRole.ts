'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery } from 'convex/react';
import { useSessionId } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import {
  MESSAGE_STORE_LIMIT,
  MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE,
  toMessage,
} from './chatroomMessageStore';
import type { Message } from '../types/message';

export function useFilteredMessagesByRole(
  chatroomId: string,
  senderRole: string,
  enabled: boolean
) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const [sessionId] = useSessionId();

  const paginated = usePaginatedQuery(
    api.messages.listMessagesBySenderRolePaginated,
    enabled && sessionId ? { chatroomId: typedChatroomId, senderRole, sessionId } : 'skip',
    { initialNumItems: MESSAGE_STORE_LIMIT }
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
    loadMore: () => paginated.loadMore(MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE),
  };
}
