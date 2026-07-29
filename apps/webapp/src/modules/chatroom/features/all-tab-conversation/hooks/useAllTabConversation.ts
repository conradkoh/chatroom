'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { usePaginatedQuery, type PaginatedQueryReference } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { toMessage } from '../../../hooks/chatroomMessageStore';
import { mapMessageToTimelineEvent } from '../../../timeline/mapMessageToTimelineEvent';
import type { TimelineEvent } from '../../../timeline/types';
import type { Message } from '../../../types/message';

const PAGE_SIZE = 50;

interface SliceState {
  messages: Message[];
  taskStatusAfterKey: string;
}

type SliceAction =
  | { type: 'SET_INITIAL'; messages: Message[] }
  | { type: 'MERGE_TAIL'; messages: Message[] }
  | { type: 'APPLY_TASK_STATUS_SIGNALS'; signals: { taskId: string; taskStatus: string }[] };

function sliceReducer(state: SliceState, action: SliceAction): SliceState {
  switch (action.type) {
    case 'SET_INITIAL':
      return { messages: action.messages, taskStatusAfterKey: '' };
    case 'MERGE_TAIL': {
      const existingIds = new Set(state.messages.map((m) => m._id));
      const newMessages = action.messages.filter((m) => !existingIds.has(m._id));
      return { ...state, messages: [...state.messages, ...newMessages] };
    }
    case 'APPLY_TASK_STATUS_SIGNALS': {
      const signalMap = new Map(action.signals.map((s) => [s.taskId, s.taskStatus]));
      let hasChanges = false;
      const updated = state.messages.map((m) => {
        if (m.taskId && signalMap.has(m.taskId)) {
          const newStatus = signalMap.get(m.taskId);
          if (newStatus && newStatus !== m.taskStatus) {
            hasChanges = true;
            return { ...m, taskStatus: newStatus as Message['taskStatus'] };
          }
        }
        return m;
      });
      return hasChanges ? { ...state, messages: updated } : state;
    }
    default:
      return state;
  }
}

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

  const paginated = usePaginatedQuery(
    api.allTabConversation.listAllTabSlicePaginated as PaginatedQueryReference,
    effectiveAnchorId && sessionId
      ? { chatroomId: typedChatroomId, sessionId, anchorMessageId: effectiveAnchorId }
      : 'skip',
    { initialNumItems: PAGE_SIZE }
  );

  const [state, dispatch] = useReducer(sliceReducer, {
    messages: [],
    taskStatusAfterKey: '',
  });

  useEffect(() => {
    dispatch({
      type: 'SET_INITIAL',
      messages: (paginated.results ?? []).flatMap((r) => {
        const m = toMessage(r);
        return m ? [m] : [];
      }),
    });
  }, [paginated.results]);

  const sliceUpperBound = nav?.sliceUpperBoundExclusive ?? null;

  const lastMessageCreationTime = useMemo(() => {
    if (state.messages.length === 0) return 0;
    return state.messages[state.messages.length - 1]!._creationTime;
  }, [state.messages]);

  const tail = useSessionQuery(
    api.allTabConversation.subscribeAllTabSliceTail,
    sessionId && effectiveAnchorId
      ? {
          chatroomId: typedChatroomId,
          afterCreationTime: lastMessageCreationTime,
          upperBoundExclusive: sliceUpperBound,
        }
      : 'skip'
  );

  useEffect(() => {
    if (tail && tail.length > 0) {
      dispatch({ type: 'MERGE_TAIL', messages: tail.map(toMessage) });
    }
  }, [tail]);

  const goToPrev = useCallback(() => {
    if (nav?.prevAnchorId) setSelectedAnchorId(nav.prevAnchorId);
  }, [nav?.prevAnchorId]);

  const goToNext = useCallback(() => {
    if (nav?.nextAnchorId) setSelectedAnchorId(nav.nextAnchorId);
  }, [nav?.nextAnchorId]);

  const events: TimelineEvent[] = useMemo(
    () => state.messages.map((m) => mapMessageToTimelineEvent(m)),
    [state.messages]
  );

  return {
    events,
    messages: state.messages,
    nav,
    isLoading: nav === undefined || paginated.status === 'LoadingFirstPage',
    isLoadingMore: paginated.status === 'LoadingMore',
    canLoadMore: paginated.status === 'CanLoadMore',
    loadMore: () => paginated.loadMore(PAGE_SIZE),
    goToPrev,
    goToNext,
    hasPrev: !!nav?.prevAnchorId,
    hasNext: !!nav?.nextAnchorId,
    isOnLatestAnchor: !nav?.nextAnchorId,
  };
}
