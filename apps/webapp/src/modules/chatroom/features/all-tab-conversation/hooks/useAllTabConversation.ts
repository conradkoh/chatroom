'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useState } from 'react';

import { toMessage } from '../../../hooks/chatroomMessageStore';
import { mapMessageToTimelineEvent } from '../../../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../../../timeline/types';
import type { Message } from '../../../types/message';

const PAGE_SIZE = 50;

/** Merge live tail messages into paginated results, deduping by id and sorting by time. */
function mergeMessagesById(base: Message[], extra: Message[]): Message[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((m) => m._id));
  const merged = [...base];
  for (const m of extra) {
    if (!seen.has(m._id)) {
      seen.add(m._id);
      merged.push(m);
    }
  }
  merged.sort((a, b) => a._creationTime - b._creationTime);
  return merged;
}

// fallow-ignore-next-line complexity
export function useAllTabConversation(chatroomId: string) {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const [sessionId] = useSessionId();
  const [selectedAnchorId, setSelectedAnchorId] = useState<Id<'chatroom_messages'> | null>(null);

  const nav = useSessionQuery(
    api.allTabConversation.getAllTabAnchorNavigation,
    sessionId
      ? {
          chatroomId: typedChatroomId,
          ...(selectedAnchorId ? { anchorMessageId: selectedAnchorId } : {}),
        }
      : 'skip'
  );

  const effectiveAnchorId = nav?.anchor?._id ?? null;

  const sliceUpperBound = nav?.sliceUpperBoundExclusive;

  const paginated = usePaginatedQuery(
    api.allTabConversation.listAllTabSlicePaginated as PaginatedQueryReference,
    effectiveAnchorId && sessionId
      ? {
          chatroomId: typedChatroomId,
          sessionId,
          anchorMessageId: effectiveAnchorId,
          ...(sliceUpperBound != null ? { sliceUpperBoundExclusive: sliceUpperBound } : {}),
        }
      : 'skip',
    { initialNumItems: PAGE_SIZE }
  );

  const paginatedMessages = useMemo(
    () =>
      (paginated.results ?? []).flatMap((r) => {
        const m = toMessage(r);
        return m ? [m] : [];
      }),
    [paginated.results]
  );

  // Only tail-subscribe when pagination exhausted (live updates only)
  const isPaginationExhausted = paginated.status === 'Exhausted';

  const lastPaginatedCreationTime = useMemo(() => {
    const last = paginatedMessages.at(-1);
    return last ? last._creationTime : 0;
  }, [paginatedMessages]);

  const tail = useSessionQuery(
    api.allTabConversation.subscribeAllTabSliceTail,
    sessionId && effectiveAnchorId && isPaginationExhausted
      ? {
          chatroomId: typedChatroomId,
          afterCreationTime: lastPaginatedCreationTime,
          upperBoundExclusive: sliceUpperBound ?? null,
        }
      : 'skip'
  );

  const tailMessages = useMemo(() => (tail ?? []).map(toMessage), [tail]);

  const messages = useMemo(
    () => mergeMessagesById(paginatedMessages, tailMessages),
    [paginatedMessages, tailMessages]
  );

  // Loading until the current anchor's first page arrives. Convex resets the
  // paginated query to LoadingFirstPage synchronously when its args change, so
  // a stale slice from the previous anchor is never shown during transitions.
  const isSliceLoading =
    nav === undefined ||
    paginated.status === 'LoadingFirstPage' ||
    (paginated.status === 'LoadingMore' && paginatedMessages.length === 0);

  const goToPrev = useCallback(() => {
    if (nav?.prevAnchorId) setSelectedAnchorId(nav.prevAnchorId);
  }, [nav?.prevAnchorId]);

  const goToNext = useCallback(() => {
    if (nav?.nextAnchorId) setSelectedAnchorId(nav.nextAnchorId);
  }, [nav?.nextAnchorId]);

  const goToLatestAnchor = useCallback(() => {
    setSelectedAnchorId(null);
  }, []);

  const events: TimelineEvent[] = useMemo(
    () => messages.map((m) => mapMessageToTimelineEvent(m)),
    [messages]
  );

  return {
    events,
    messages,
    nav,
    isLoading: isSliceLoading,
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore: () => paginated.loadMore(PAGE_SIZE),
    goToPrev,
    goToNext,
    goToLatestAnchor,
    hasPrev: !!nav?.prevAnchorId,
    hasNext: !!nav?.nextAnchorId,
    isOnLatestAnchor: selectedAnchorId === null,
    anchorId: effectiveAnchorId,
  };
}
