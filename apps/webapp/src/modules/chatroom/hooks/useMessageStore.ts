'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef } from 'react';

// ─── Types ──────────────────────────────────────

/** Message shape returned by the cursor-based query endpoints. */
export interface StoreMessage {
  _id: string;
  type: string;
  senderRole: string;
  targetRole?: string;
  content: string;
  _creationTime: number;
  classification?: 'question' | 'new_feature' | 'follow_up';
  taskId?: string;
  taskStatus?: string;
  sourcePlatform?: string;
  featureTitle?: string;
  featureDescription?: string;
  featureTechSpecs?: string;
  attachedTasks?: { _id: string; content: string; status: string }[];
  attachedBacklogItems?: { id: string; content: string; status: string }[];
  attachedArtifacts?: { _id: string; filename: string; description?: string; mimeType?: string }[];
  attachedMessages?: { _id: string; content: string; senderRole: string; _creationTime: number }[];
  attachedWorkflows?: { _id: string; workflowKey: string; status: string }[];
  latestProgress?: { content: string; senderRole: string; _creationTime: number };
  isQueued?: boolean;
}

interface MessageStoreState {
  messages: StoreMessage[];
  oldestCursor: number | null;
  newestCursor: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  /** When set, triggers the getOlderMessages query */
  olderQueryCursor: number | null;
}

// ─── Reducer actions ────────────────────────────

type Action =
  | { type: 'INITIALIZE'; messages: StoreMessage[]; cursor: number | null }
  | { type: 'APPEND_NEW'; messages: StoreMessage[] }
  | { type: 'PREPEND_OLDER'; messages: StoreMessage[]; hasMore: boolean }
  | { type: 'PURGE_OLD'; keepAboveCount: number; viewportTopIndex: number }
  | { type: 'SET_LOADING_OLDER'; loading: boolean }
  | { type: 'REQUEST_OLDER' }
  | { type: 'CLEAR_OLDER_REQUEST' };

function deduplicateMessages(existing: StoreMessage[], incoming: StoreMessage[]): StoreMessage[] {
  const existingIds = new Set(existing.map((m) => m._id));
  return incoming.filter((m) => !existingIds.has(m._id));
}

function messageStoreReducer(state: MessageStoreState, action: Action): MessageStoreState {
  switch (action.type) {
    case 'INITIALIZE': {
      if (state.isInitialized) return state;
      const messages = action.messages;
      const oldestCursor = messages.length > 0 ? messages[0]._creationTime : null;
      const newestCursor = action.cursor;
      return {
        ...state,
        messages,
        oldestCursor,
        newestCursor,
        isInitialized: true,
        // If we got fewer messages than requested, there are no older ones
        // (we don't know the limit here, so assume there could be more)
        hasMoreOlder: messages.length > 0,
      };
    }

    case 'APPEND_NEW': {
      if (action.messages.length === 0) return state;
      const newMessages = deduplicateMessages(state.messages, action.messages);
      if (newMessages.length === 0) return state;
      const merged = [...state.messages, ...newMessages];
      const newestCursor = merged[merged.length - 1]._creationTime;
      return {
        ...state,
        messages: merged,
        newestCursor,
      };
    }

    case 'PREPEND_OLDER': {
      const newMessages = deduplicateMessages(state.messages, action.messages);
      if (newMessages.length === 0) {
        return {
          ...state,
          hasMoreOlder: action.hasMore,
          isLoadingOlder: false,
          olderQueryCursor: null,
        };
      }
      const merged = [...newMessages, ...state.messages];
      const oldestCursor = merged[0]._creationTime;
      return {
        ...state,
        messages: merged,
        oldestCursor,
        hasMoreOlder: action.hasMore,
        isLoadingOlder: false,
        olderQueryCursor: null,
      };
    }

    case 'PURGE_OLD': {
      // Keep at most keepAboveCount messages above viewportTopIndex
      const { keepAboveCount, viewportTopIndex } = action;
      const purgeCount = viewportTopIndex - keepAboveCount;
      if (purgeCount <= 0) return state;
      const purged = state.messages.slice(purgeCount);
      const oldestCursor = purged.length > 0 ? purged[0]._creationTime : null;
      return {
        ...state,
        messages: purged,
        oldestCursor,
        hasMoreOlder: true, // purged messages can be re-loaded
      };
    }

    case 'SET_LOADING_OLDER':
      return { ...state, isLoadingOlder: action.loading };

    case 'REQUEST_OLDER': {
      if (state.isLoadingOlder || !state.hasMoreOlder || !state.oldestCursor) return state;
      return {
        ...state,
        isLoadingOlder: true,
        olderQueryCursor: state.oldestCursor,
      };
    }

    case 'CLEAR_OLDER_REQUEST':
      return { ...state, olderQueryCursor: null };

    default:
      return state;
  }
}

const initialState: MessageStoreState = {
  messages: [],
  oldestCursor: null,
  newestCursor: null,
  isInitialized: false,
  hasMoreOlder: true,
  isLoadingOlder: false,
  olderQueryCursor: null,
};

// ─── Hook ───────────────────────────────────────

export function useMessageStore(chatroomId: string) {
  const [state, dispatch] = useReducer(messageStoreReducer, initialState);
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;

  // ── Initial load ──────────────────────────────
  const initialData = useSessionQuery(api.messages.getLatestMessages, {
    chatroomId: typedChatroomId,
    limit: 5,
  });

  useEffect(() => {
    if (initialData && !state.isInitialized) {
      dispatch({
        type: 'INITIALIZE',
        messages: initialData.messages as StoreMessage[],
        cursor: initialData.cursor,
      });
    }
  }, [initialData, state.isInitialized]);

  // ── Tail subscription ─────────────────────────
  const tailData = useSessionQuery(
    api.messages.getMessagesSince,
    state.newestCursor != null
      ? { chatroomId: typedChatroomId, sinceCursor: state.newestCursor }
      : 'skip'
  );

  useEffect(() => {
    if (tailData && tailData.messages.length > 0) {
      dispatch({ type: 'APPEND_NEW', messages: tailData.messages as StoreMessage[] });
    }
  }, [tailData]);

  // ── Older messages (on-demand) ────────────────
  const olderData = useSessionQuery(
    api.messages.getOlderMessages,
    state.olderQueryCursor != null
      ? { chatroomId: typedChatroomId, beforeCursor: state.olderQueryCursor, limit: 10 }
      : 'skip'
  );

  // Track the cursor we've already processed to avoid re-dispatching
  const processedOlderCursorRef = useRef<number | null>(null);

  useEffect(() => {
    if (
      olderData &&
      state.olderQueryCursor != null &&
      processedOlderCursorRef.current !== state.olderQueryCursor
    ) {
      processedOlderCursorRef.current = state.olderQueryCursor;
      dispatch({
        type: 'PREPEND_OLDER',
        messages: olderData.messages as StoreMessage[],
        hasMore: olderData.hasMore,
      });
    }
  }, [olderData, state.olderQueryCursor]);

  // ── Public API ────────────────────────────────

  const loadOlderMessages = useCallback(() => {
    dispatch({ type: 'REQUEST_OLDER' });
  }, []);

  const purgeOldMessages = useCallback((viewportTopIndex: number) => {
    dispatch({ type: 'PURGE_OLD', keepAboveCount: 50, viewportTopIndex });
  }, []);

  return {
    messages: state.messages,
    isLoading: !state.isInitialized,
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlderMessages,
    purgeOldMessages,
  };
}
