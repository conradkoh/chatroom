'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef } from 'react';

import type { Message } from '../types/message';

// ─── State ──────────────────────────────────────

export interface MessageStoreState {
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

export type Action =
  | { type: 'INITIALIZE'; messages: Message[]; cursor: number | null; hasMore: boolean }
  | { type: 'APPEND_NEW'; messages: Message[] }
  | { type: 'PREPEND_OLDER'; messages: Message[]; hasMore: boolean }
  | { type: 'PURGE_OLD'; keepAboveCount: number; viewportTopIndex: number }
  | { type: 'REQUEST_OLDER' }
  | { type: 'RESET' }
  /** Update taskStatus on messages that have the given taskId */
  | { type: 'UPDATE_TASK_STATUS'; taskId: string; newStatus: string };

export function deduplicateMessages(existing: Message[], incoming: Message[]): Message[] {
  const existingIds = new Set(existing.map((m) => m._id));
  return incoming.filter((m) => !existingIds.has(m._id));
}

export function messageStoreReducer(state: MessageStoreState, action: Action): MessageStoreState {
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

    case 'UPDATE_TASK_STATUS': {
      const { taskId, newStatus } = action;
      const updatedMessages = state.messages.map((msg) =>
        msg.taskId === taskId ? { ...msg, taskStatus: newStatus as Message['taskStatus'] } : msg
      );
      return {
        ...state,
        messages: updatedMessages,
      };
    }

    default:
      return state;
  }
}

export const initialState: MessageStoreState = {
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

  // Pin the tail cursor so the getMessagesSince subscription doesn't churn.
  //
  // Race condition safety: tailCursorRef is set inside a useEffect (after the
  // initial getLatestMessages data resolves), so getMessagesSince won't subscribe
  // until the next render. Any messages created between the initial query's
  // snapshot and subscription start are NOT lost because getMessagesSince uses
  // `_creationTime > sinceCursor` — Convex re-evaluates the reactive query
  // against the current DB state when the subscription begins, so it will
  // return all messages newer than the cursor regardless of when they arrived.
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

  // ── Task status subscription ─────────────────
  // Subscribe to all active tasks (pending, acknowledged, in_progress) to update
  // message taskStatus when task transitions occur. Without this subscription,
  // existing messages in the store would show stale status even after task transitions.
  const activeTasks = useSessionQuery(api.tasks.listTasks, {
    chatroomId: typedChatroomId,
    statusFilter: 'active',
  });

  useEffect(() => {
    if (!activeTasks || activeTasks.length === 0) return;

    // Update taskStatus on all messages that have these taskIds
    // This ensures the UI reflects the current task status after transitions
    for (const task of activeTasks) {
      dispatch({
        type: 'UPDATE_TASK_STATUS',
        taskId: task._id,
        newStatus: task.status,
      });
    }
  }, [activeTasks]);

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
    updateTaskStatus: (taskId: string, newStatus: string) => {
      dispatch({ type: 'UPDATE_TASK_STATUS', taskId, newStatus });
    },
  };
}
