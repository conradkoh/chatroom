'use client';

/**
 * useChatroomMessageStore — dual-subscription delta store for the timeline.
 *
 * Architecture:
 * 1. Initial load — imperative getLatestMessages(limit)
 * 2. New-messages tail — useSessionQuery(subscribeNewMessages, { afterCreationTime: newest })
 * 3. Visible-message updates — useSessionQuery(subscribeVisibleMessageUpdates, { messageIds: recent })
 * 4. Merge — reducer appends/updates by _id; chronological order in store
 * 5. Older pages — imperative listMessagesBefore on scroll-up
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Dispatch } from 'react';

import {
  chatroomMessageStoreInitialState,
  chatroomMessageStoreReducer,
  filterNewMessages,
  hasMoreOlderAfterPage,
  inferHasMoreOlder,
  MESSAGE_STORE_LIMIT,
  MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE,
  toMessage,
  VISIBLE_UPDATE_WINDOW,
  type ChatroomMessageStoreAction,
  type ChatroomMessageStoreState,
} from './chatroomMessageStore';
import { logLoadOlder } from '../components/timeline/timelineLoadOlderDebug';
import type { Message } from '../types/message';

// ─── Delta subscriptions ─────────────────────────────────────────────────────

/**
 * Wires the two reactive timeline subscriptions and dispatches their results:
 *  - subscribeNewMessages pinned to the NEWEST seen row (strict cursor → near-empty result).
 *  - subscribeVisibleMessageUpdates for the most-recent VISIBLE_UPDATE_WINDOW messages
 *    (lightweight task/progress deltas only).
 */
// fallow-ignore-next-line complexity
function useTimelineDeltaSubscriptions(
  typedChatroomId: Id<'chatroom_rooms'>,
  state: ChatroomMessageStoreState,
  dispatch: Dispatch<ChatroomMessageStoreAction>,
  enabled: boolean
): void {
  // New-messages tail (newest-cursor, near-empty result).
  const newestSeenCreationTime =
    state.messages.length > 0
      ? state.messages[state.messages.length - 1]._creationTime
      : state.isInitialized
        ? 0
        : null;

  const newMessagesData = useSessionQuery(
    api.messageList.subscribeNewMessages,
    enabled && state.isInitialized && newestSeenCreationTime !== null
      ? { chatroomId: typedChatroomId, afterCreationTime: newestSeenCreationTime }
      : 'skip'
  );

  useEffect(() => {
    if (!newMessagesData) return;
    dispatch({ type: 'MERGE_TAIL', messages: newMessagesData.map(toMessage) });
  }, [newMessagesData, dispatch]);

  // Visible-message updates (lightweight status/progress delta). The id list is keyed by
  // a stable join so it only changes identity when the visible ID set changes.
  const recentVisibleIdsKey = state.messages
    .slice(-VISIBLE_UPDATE_WINDOW)
    .map((m) => m._id)
    .join(',');
  const recentVisibleIds = useMemo(
    () =>
      recentVisibleIdsKey ? (recentVisibleIdsKey.split(',') as Id<'chatroom_messages'>[]) : [],
    [recentVisibleIdsKey]
  );

  const visibleUpdatesData = useSessionQuery(
    api.messageList.subscribeVisibleMessageUpdates,
    enabled && state.isInitialized && recentVisibleIds.length > 0
      ? { chatroomId: typedChatroomId, messageIds: recentVisibleIds }
      : 'skip'
  );

  useEffect(() => {
    if (!visibleUpdatesData) return;
    dispatch({
      type: 'APPLY_VISIBLE_UPDATES',
      updates: visibleUpdatesData.map((u) => ({
        _id: u._id,
        taskStatus: u.taskStatus as Message['taskStatus'],
        latestProgress: u.latestProgress,
      })),
    });
  }, [visibleUpdatesData, dispatch]);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseChatroomMessageStoreResult {
  messages: Message[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: () => void;
  removeMessagesForTask: (taskId: string) => void;
  purgeToInitialWindow: () => void;
}

const noop = () => {};

const DISABLED_STORE_RESULT: UseChatroomMessageStoreResult = {
  messages: [],
  isLoading: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
  loadOlderMessages: noop,
  removeMessagesForTask: noop,
  purgeToInitialWindow: noop,
};

export function useChatroomMessageStore(
  chatroomId: string,
  enabled = true
): UseChatroomMessageStoreResult {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const [state, dispatch] = useReducer(
    chatroomMessageStoreReducer,
    chatroomMessageStoreInitialState
  );
  const [initialLoadRequested, setInitialLoadRequested] = useState(false);
  const isLoadingOlderRef = useRef(false);
  /** When a page overlaps the tail window (duplicates only), next load uses this cursor. */
  const loadOlderBeforeRef = useRef<number | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const hasMoreOlderRef = useRef(false);
  const isInitializedRef = useRef(false);
  messagesRef.current = state.messages;
  hasMoreOlderRef.current = state.hasMoreOlder;
  isInitializedRef.current = state.isInitialized;

  useEffect(() => {
    dispatch({ type: 'RESET' });
    setInitialLoadRequested(false);
    isLoadingOlderRef.current = false;
    loadOlderBeforeRef.current = null;
  }, [chatroomId]);

  // ── Initial load (imperative, one-shot) ───────────────────────────────────
  useEffect(() => {
    if (!enabled || state.isInitialized || !sessionId || initialLoadRequested) return;
    setInitialLoadRequested(true);

    void convex
      .query(api.messageList.getLatestMessages, {
        sessionId,
        chatroomId: typedChatroomId,
        limit: MESSAGE_STORE_LIMIT,
      })
      .then((data) => {
        const messages = data.messages.map(toMessage);
        dispatch({
          type: 'INITIALIZE',
          messages,
          tailAfterCreationTime: data.tailAfterCreationTime,
          hasMoreOlder: inferHasMoreOlder(messages.length, data.hasMore),
        });
      })
      .catch((err: unknown) => {
        console.error('[useChatroomMessageStore] Initial load failed:', err);
        setInitialLoadRequested(false);
      });
  }, [enabled, state.isInitialized, sessionId, convex, typedChatroomId, initialLoadRequested]);

  // ── Reactive delta subscriptions (new-messages tail + visible-message updates) ──
  useTimelineDeltaSubscriptions(typedChatroomId, state, dispatch, enabled);

  const loadOlderMessages = useCallback(() => {
    if (
      isLoadingOlderRef.current ||
      !hasMoreOlderRef.current ||
      !sessionId ||
      !isInitializedRef.current
    ) {
      logLoadOlder('loadOlderMessages skipped', {
        reason: isLoadingOlderRef.current
          ? 'in-flight'
          : !hasMoreOlderRef.current
            ? 'noMoreOlder'
            : !sessionId
              ? 'no sessionId'
              : 'notInitialized',
      });
      return;
    }

    const oldestInStore = messagesRef.current[0];
    if (!oldestInStore) {
      logLoadOlder('loadOlderMessages skipped', { reason: 'emptyStore' });
      return;
    }

    isLoadingOlderRef.current = true;
    dispatch({ type: 'LOAD_OLDER_START' });

    void (async () => {
      try {
        let before = loadOlderBeforeRef.current ?? oldestInStore._creationTime;
        logLoadOlder('loadOlderMessages fetch', {
          before,
          oldestId: oldestInStore._id,
          currentCount: messagesRef.current.length,
        });

        let page = (
          await convex.query(api.messageList.listMessagesBefore, {
            chatroomId: typedChatroomId,
            before,
            limit: MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE,
            sessionId,
          })
        ).map(toMessage);

        // Overlap with the tail window can return duplicates only — retry further back once.
        let newOnes = filterNewMessages(messagesRef.current, page);
        if (newOnes.length === 0 && page.length > 0) {
          const minTime = Math.min(...page.map((m) => m._creationTime));
          before = minTime - 1;
          page = (
            await convex.query(api.messageList.listMessagesBefore, {
              chatroomId: typedChatroomId,
              before,
              limit: MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE,
              sessionId,
            })
          ).map(toMessage);
          newOnes = filterNewMessages(messagesRef.current, page);
        }

        if (page.length === 0) {
          loadOlderBeforeRef.current = null;
        } else if (newOnes.length === 0) {
          const minTime = Math.min(...page.map((m) => m._creationTime));
          loadOlderBeforeRef.current = minTime - 1;
        } else {
          loadOlderBeforeRef.current = null;
        }

        dispatch({
          type: 'PREPEND_OLDER',
          messages: newOnes,
          hasMoreOlder: hasMoreOlderAfterPage(page.length),
        });
        logLoadOlder('loadOlderMessages result', {
          fetched: page.length,
          prepended: newOnes.length,
          before,
        });
      } catch (err: unknown) {
        logLoadOlder('loadOlderMessages error', {
          message: err instanceof Error ? err.message : String(err),
        });
        dispatch({ type: 'LOAD_OLDER_FAILED' });
      } finally {
        isLoadingOlderRef.current = false;
      }
    })();
  }, [convex, typedChatroomId, sessionId]);

  const removeMessagesForTask = useCallback(
    (taskId: string) => dispatch({ type: 'REMOVE_BY_TASK_ID', taskId }),
    []
  );

  const purgeToInitialWindow = useCallback(() => {
    loadOlderBeforeRef.current = null;
    dispatch({ type: 'TRIM_TO_INITIAL_WINDOW' });
  }, []);

  if (!enabled) {
    return DISABLED_STORE_RESULT;
  }

  return {
    messages: state.messages,
    isLoading: !state.isInitialized,
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlderMessages,
    removeMessagesForTask,
    purgeToInitialWindow,
  };
}
