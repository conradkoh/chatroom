'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { shallowEqualRecord, structurallyEqual } from './stableIdentity';
import { toMessage } from '../../../hooks/chatroomMessageStore';
import { getHandoffDurationMs } from '../../../timeline/handoffTiming';
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
export function useConversation(chatroomId: string) {
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

  const sliceUpperBound = nav?.sliceUpperBoundExclusive ?? null;

  const paginated = usePaginatedQuery(
    api.allTabConversation.listAllTabSlicePaginated as PaginatedQueryReference,
    effectiveAnchorId && sessionId && nav !== undefined
      ? {
          chatroomId: typedChatroomId,
          sessionId,
          anchorMessageId: effectiveAnchorId,
          sliceUpperBoundExclusive: sliceUpperBound,
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

  const mergedMessages = useMemo(
    () => mergeMessagesById(paginatedMessages, tailMessages),
    [paginatedMessages, tailMessages]
  );

  // Reuse the previous `Message` object whenever the served document is equal.
  // Convex rebuilds the whole document tree on each update, so without this every
  // row below receives a new object and `memo` never bails out (O(N) per update).
  //
  // This writes a ref during render. That is safe because the write is idempotent
  // for a given `mergedMessages` (same input → same cache) and a render React
  // discards only costs one extra stabilization pass on the next render.
  const stableMessagesRef = useRef<Map<string, Message>>(new Map());
  const messages = useMemo(() => {
    const previousById = stableMessagesRef.current;
    const nextById = new Map<string, Message>();
    const stabilized = mergedMessages.map((message) => {
      const previous = previousById.get(message._id);
      const stable = previous && structurallyEqual(previous, message) ? previous : message;
      nextById.set(message._id, stable);
      return stable;
    });
    // Cache only the ids present in this pass so it never grows unbounded.
    stableMessagesRef.current = nextById;
    return stabilized;
  }, [mergedMessages]);

  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message._id, message] as const)),
    [messages]
  );

  // Loading until the current anchor's first page arrives. Convex resets the
  // paginated query to LoadingFirstPage synchronously when its args change, so
  // a stale slice from the previous anchor is never shown during transitions.
  const isEmptyChatroom = nav !== undefined && nav.anchor === null;

  const isSliceLoading =
    !isEmptyChatroom &&
    (nav === undefined ||
      paginated.status === 'LoadingFirstPage' ||
      (paginated.status === 'LoadingMore' && paginatedMessages.length === 0));

  const goToPrev = useCallback(() => {
    if (nav?.prevAnchorId) setSelectedAnchorId(nav.prevAnchorId);
  }, [nav?.prevAnchorId]);

  const goToNext = useCallback(() => {
    if (nav?.nextAnchorId) setSelectedAnchorId(nav.nextAnchorId);
  }, [nav?.nextAnchorId]);

  const goToLatestAnchor = useCallback(() => {
    setSelectedAnchorId(null);
  }, []);

  // `handoffDurationMs` is derived from other messages, so an event is keyed on
  // both its message (now identity-stable) and the freshly computed duration.
  //
  // Like `stableMessagesRef`, this ref write happens during render. It is safe
  // because the write is idempotent per `messages`/`messagesById` pair, and a
  // discarded render only costs one extra pass on the next render.
  const stableEventsRef = useRef<Map<string, TimelineEvent>>(new Map());
  const events: TimelineEvent[] = useMemo(() => {
    const previousById = stableEventsRef.current;
    const nextById = new Map<string, TimelineEvent>();
    const stabilized = messages.map((message) => {
      const next = mapMessageToTimelineEvent(message, getHandoffDurationMs(message, messagesById));
      const previous = previousById.get(next.id);
      const stable = previous && shallowEqualRecord(previous, next) ? previous : next;
      nextById.set(next.id, stable);
      return stable;
    });
    stableEventsRef.current = nextById;
    return stabilized;
  }, [messages, messagesById]);

  // `usePaginatedQuery` allocates a fresh `loadMore` on every render, so keep the
  // latest one in a ref to expose a callback whose identity never changes.
  // `useLayoutEffect` matches the `eventsRef` sync in `ConversationMessageList`, so both
  // refs are current before the browser can paint or scroll.
  const paginatedLoadMoreRef = useRef(paginated.loadMore);
  useLayoutEffect(() => {
    paginatedLoadMoreRef.current = paginated.loadMore;
  }, [paginated.loadMore]);
  const loadMore = useCallback(() => paginatedLoadMoreRef.current(PAGE_SIZE), []);

  return {
    events,
    messages,
    nav,
    isLoading: isSliceLoading,
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore,
    goToPrev,
    goToNext,
    goToLatestAnchor,
    hasPrev: !!nav?.prevAnchorId,
    hasNext: !!nav?.nextAnchorId,
    isOnLatestAnchor: selectedAnchorId === null,
    anchorId: effectiveAnchorId,
  };
}
