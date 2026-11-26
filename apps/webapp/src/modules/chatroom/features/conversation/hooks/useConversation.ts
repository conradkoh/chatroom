'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { shallowEqualRecord, structurallyEqual } from './stableIdentity';
import {
  getHandoffDurationMs,
  getSlowHandoffThresholdMs,
  isSlowHandoffDuration,
} from '../../../timeline/handoffTiming';
import { mapMessageToTimelineEvent } from '../../../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../../../timeline/types';
import type { Message } from '../../../types/message';

/** Convex pagination batch size. Not a domain page. */
const FETCH_BATCH_SIZE = 50;

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
  const [selectedPageId, setSelectedPageId] = useState<Id<'chatroom_messages'> | null>(null);

  // before/after are omitted: the window is the single selected page.
  const pageNav = useSessionQuery(
    api.conversation.listPages,
    sessionId
      ? { chatroomId: typedChatroomId, ...(selectedPageId ? { pageId: selectedPageId } : {}) }
      : 'skip'
  );

  const currentPage = pageNav?.pages[0] ?? null;
  const pageId = pageNav?.selectedPageId ?? null;
  const endExclusive = currentPage?.endExclusive ?? null;

  const paginated = usePaginatedQuery(
    api.conversation.listPageMessages as PaginatedQueryReference,
    pageId && sessionId && pageNav !== undefined
      ? { chatroomId: typedChatroomId, sessionId, pageId, endExclusive }
      : 'skip',
    { initialNumItems: FETCH_BATCH_SIZE }
  );

  // Results are already canonical Message rows (wire projection), so no per-row mapping.
  // The only gap is the webapp's `backlogStatus` narrowing; the wire value is a task status.
  const paginatedMessages = useMemo<Message[]>(
    () => (paginated.results ?? []) as Message[],
    [paginated.results]
  );

  // Only tail-subscribe when pagination exhausted (live updates only)
  const isPaginationExhausted = paginated.status === 'Exhausted';

  const lastPaginatedCreationTime = useMemo(() => {
    const last = paginatedMessages.at(-1);
    return last ? last._creationTime : 0;
  }, [paginatedMessages]);

  const tail = useSessionQuery(
    api.conversation.subscribePageTail,
    sessionId && pageId && isPaginationExhausted
      ? {
          chatroomId: typedChatroomId,
          afterCreationTime: lastPaginatedCreationTime,
          endExclusive,
        }
      : 'skip'
  );

  const tailMessages = useMemo<Message[]>(() => (tail ?? []) as Message[], [tail]);

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

  // Loading until the current page's first batch arrives. Convex resets the
  // paginated query to LoadingFirstPage synchronously when its args change, so
  // a stale page from the previous page is never shown during transitions.
  const isEmptyChatroom = pageNav !== undefined && pageNav.selectedPageId === null;

  const isSliceLoading =
    !isEmptyChatroom &&
    (pageNav === undefined ||
      paginated.status === 'LoadingFirstPage' ||
      (paginated.status === 'LoadingMore' && paginatedMessages.length === 0));

  const goToPrevPage = useCallback(() => {
    if (pageNav?.prevPageId) setSelectedPageId(pageNav.prevPageId);
  }, [pageNav?.prevPageId]);

  const goToNextPage = useCallback(() => {
    if (pageNav?.nextPageId) setSelectedPageId(pageNav.nextPageId);
  }, [pageNav?.nextPageId]);

  const goToLatestPage = useCallback(() => {
    setSelectedPageId(null);
  }, []);

  // `handoffDurationMs` is derived from the previous message, so an event is keyed
  // on both its message (now identity-stable) and the freshly computed duration.
  // `handoffDurationSlow` depends on the whole window's duration distribution, so a
  // newly loaded message can recolor older rows.
  //
  // Like `stableMessagesRef`, this ref write happens during render. It is safe
  // because the write is idempotent per `messages`, and a discarded render only
  // costs one extra pass on the next render.
  const stableEventsRef = useRef<Map<string, TimelineEvent>>(new Map());
  const events: TimelineEvent[] = useMemo(() => {
    const previousById = stableEventsRef.current;
    const nextById = new Map<string, TimelineEvent>();
    const durations = messages.map((message, index) =>
      getHandoffDurationMs(message, messages[index - 1])
    );
    const slowThresholdMs = getSlowHandoffThresholdMs(durations);
    const stabilized = messages.map((message, index) => {
      const durationMs = durations[index];
      const next = mapMessageToTimelineEvent(
        message,
        durationMs,
        isSlowHandoffDuration(durationMs, slowThresholdMs)
      );
      const previous = previousById.get(next.id);
      const stable = previous && shallowEqualRecord(previous, next) ? previous : next;
      nextById.set(next.id, stable);
      return stable;
    });
    stableEventsRef.current = nextById;
    return stabilized;
  }, [messages]);

  // `usePaginatedQuery` allocates a fresh `loadMore` on every render, so keep the
  // latest one in a ref to expose a callback whose identity never changes.
  // `useLayoutEffect` keeps this ref current before the browser can paint or scroll.
  const paginatedLoadMoreRef = useRef(paginated.loadMore);
  useLayoutEffect(() => {
    paginatedLoadMoreRef.current = paginated.loadMore;
  }, [paginated.loadMore]);
  const loadMore = useCallback(() => paginatedLoadMoreRef.current(FETCH_BATCH_SIZE), []);

  return {
    events,
    messages,
    pageNav,
    isLoading: isSliceLoading,
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore,
    goToPrevPage,
    goToNextPage,
    goToLatestPage,
    hasPrevPage: !!pageNav?.prevPageId,
    hasNextPage: !!pageNav?.nextPageId,
    isOnLatestPage: selectedPageId === null,
    pageId,
  };
}
