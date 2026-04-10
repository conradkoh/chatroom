'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef } from 'react';

import type { Message } from '../types/message';

// ─── State ──────────────────────────────────────

interface MessageStoreState {
  messages: Message[];
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
  | { type: 'INITIALIZE'; messages: Message[]; cursor: number | null; hasMore: boolean }
  | { type: 'APPEND_NEW'; messages: Message[] }
  | { type: 'PREPEND_OLDER'; messages: Message[]; hasMore: boolean }
  | { type: 'PURGE_OLD'; keepAboveCount: number; viewportTopIndex: number }
  | { type: 'REQUEST_OLDER' }
  | { type: 'RESET' };

function deduplicateMessages(existing: Message[], incoming: Message[]): Message[] {
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
        hasMoreOlder: action.hasMore,
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

    case 'REQUEST_OLDER': {
      if (state.isLoadingOlder || !state.hasMoreOlder || !state.oldestCursor) return state;
      return {
        ...state,
        isLoadingOlder: true,
        olderQueryCursor: state.oldestCursor,
      };
    }

    case 'RESET':
      return initialState;

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

  // Track the cursor we've already processed for older loads
  const processedOlderCursorRef = useRef<number | null>(null);

  // Pin the tail cursor so the getMessagesSince subscription doesn't churn
  const tailCursorRef = useRef<number | null>(null);

  // ── Reset on chatroom navigation (must run BEFORE initialization) ──
  const prevChatroomIdRef = useRef(chatroomId);
  useEffect(() => {
    if (prevChatroomIdRef.current !== chatroomId) {
      prevChatroomIdRef.current = chatroomId;
      dispatch({ type: 'RESET' });
      processedOlderCursorRef.current = null;
      tailCursorRef.current = null;
    }
  }, [chatroomId]);

  // ── Initial load ──────────────────────────────
  const initialData = useSessionQuery(
    api.messages.getLatestMessages,
    state.isInitialized ? 'skip' : { chatroomId: typedChatroomId, limit: 5 }
  );

  useEffect(() => {
    if (initialData && !state.isInitialized) {
      tailCursorRef.current = initialData.cursor;
      dispatch({
        type: 'INITIALIZE',
        messages: initialData.messages as Message[],
        cursor: initialData.cursor,
        hasMore: initialData.hasMore,
      });
    }
  }, [initialData, state.isInitialized]);

  // ── Tail subscription (pinned cursor) ─────────
  const tailData = useSessionQuery(
    api.messages.getMessagesSince,
    tailCursorRef.current != null
      ? { chatroomId: typedChatroomId, sinceCursor: tailCursorRef.current }
      : 'skip'
  );

  useEffect(() => {
    if (tailData && tailData.messages.length > 0) {
      dispatch({ type: 'APPEND_NEW', messages: tailData.messages as Message[] });
    }
  }, [tailData]);

  // ── Older messages (on-demand) ────────────────
  const olderData = useSessionQuery(
    api.messages.getOlderMessages,
    state.olderQueryCursor != null
      ? { chatroomId: typedChatroomId, beforeCursor: state.olderQueryCursor, limit: 10 }
      : 'skip'
  );

  useEffect(() => {
    if (
      olderData &&
      state.olderQueryCursor != null &&
      processedOlderCursorRef.current !== state.olderQueryCursor
    ) {
      processedOlderCursorRef.current = state.olderQueryCursor;
      dispatch({
        type: 'PREPEND_OLDER',
        messages: olderData.messages as Message[],
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
