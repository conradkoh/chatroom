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

import { logLoadOlder } from '../components/timeline/timelineLoadOlderDebug';
import type { Message } from '../types/message';

export const MESSAGE_STORE_LIMIT = 5;
export const MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE = 5;
/** How many of the most-recent messages to keep "live" for status/progress updates. */
export const VISIBLE_UPDATE_WINDOW = 30;

/** Match legacy useMessages: a full initial window implies more history may exist. */
export function inferHasMoreOlder(messageCount: number, hasMoreFromServer: boolean): boolean {
  return hasMoreFromServer || messageCount >= MESSAGE_STORE_LIMIT;
}

export function trimMessagesToInitialWindow(messages: Message[]): Message[] {
  if (messages.length <= MESSAGE_STORE_LIMIT) return messages;
  return messages.slice(-MESSAGE_STORE_LIMIT);
}

/** History is exhausted only when the server returns zero rows for a page. */
export function hasMoreOlderAfterPage(pageLength: number): boolean {
  return pageLength > 0;
}

// ─── Wire → domain mapping ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toMessage(m: any): Message {
  return {
    _id: m._id,
    type: m.type,
    senderRole: m.senderRole,
    targetRole: m.targetRole,
    content: m.content,
    _creationTime: m._creationTime,
    classification: m.classification,
    taskId: m.taskId,
    taskStatus: m.taskStatus,
    sourcePlatform: m.sourcePlatform,
    featureTitle: m.featureTitle,
    featureDescription: m.featureDescription,
    featureTechSpecs: m.featureTechSpecs,
    attachedTasks: m.attachedTasks,
    attachedBacklogItems: m.attachedBacklogItems,
    attachedArtifacts: m.attachedArtifacts,
    attachedMessages: m.attachedMessages,
    attachedSnippets: m.attachedSnippets,
    latestProgress: m.latestProgress,
    isQueued: m.isQueued,
    contextCreatedBy: m.contextCreatedBy,
  };
}

// ─── State ───────────────────────────────────────────────────────────────────

interface State {
  messages: Message[];
  tailAfterCreationTime: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
}

const initialState: State = {
  messages: [],
  tailAfterCreationTime: null,
  isInitialized: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
};

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | {
      type: 'INITIALIZE';
      messages: Message[];
      tailAfterCreationTime: number;
      hasMoreOlder: boolean;
    }
  | { type: 'MERGE_TAIL'; messages: Message[] }
  | { type: 'PREPEND_OLDER'; messages: Message[]; hasMoreOlder: boolean }
  | { type: 'LOAD_OLDER_START' }
  | { type: 'LOAD_OLDER_FAILED' }
  | { type: 'RESET' }
  | { type: 'APPLY_VISIBLE_UPDATES'; updates: VisibleUpdate[] }
  | { type: 'REMOVE_BY_TASK_ID'; taskId: string }
  | { type: 'TRIM_TO_INITIAL_WINDOW' };

function mergeMessagesById(existing: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return existing;
  const idxById = new Map(existing.map((m, i) => [m._id, i]));
  const result = [...existing];
  for (const msg of incoming) {
    const idx = idxById.get(msg._id);
    if (idx !== undefined) {
      result[idx] = msg;
    } else {
      result.push(msg);
    }
  }
  result.sort((a, b) => a._creationTime - b._creationTime);
  return result;
}

function filterNewMessages(existing: Message[], incoming: Message[]): Message[] {
  const existingIds = new Set(existing.map((m) => m._id));
  return incoming.filter((m) => !existingIds.has(m._id));
}

interface VisibleUpdate {
  _id: Message['_id'];
  taskStatus?: Message['taskStatus'];
  latestProgress?: Message['latestProgress'];
}

function sameProgress(a: Message['latestProgress'], b: Message['latestProgress']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.content === b.content && a.senderRole === b.senderRole && a._creationTime === b._creationTime
  );
}

export function applyVisibleUpdates(existing: Message[], updates: VisibleUpdate[]): Message[] {
  if (updates.length === 0) return existing;
  const byId = new Map(updates.map((u) => [u._id, u]));
  let changed = false;
  const next = existing.map((m) => {
    const u = byId.get(m._id);
    if (!u) return m;
    if (m.taskStatus === u.taskStatus && sameProgress(m.latestProgress, u.latestProgress)) return m;
    changed = true;
    return { ...m, taskStatus: u.taskStatus, latestProgress: u.latestProgress };
  });
  return changed ? next : existing;
}

/** Evict all messages linked to a deleted task (pure helper for reducer + tests). */
// fallow-ignore-next-line unused-export
export function removeMessagesForTaskId(messages: Message[], taskId: string): Message[] {
  return messages.filter((m) => m.taskId !== taskId);
}

// fallow-ignore-next-line complexity
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INITIALIZE': {
      if (state.isInitialized) return state;
      return {
        ...state,
        messages: action.messages,
        tailAfterCreationTime: action.tailAfterCreationTime,
        isInitialized: true,
        hasMoreOlder: action.hasMoreOlder,
      };
    }
    case 'MERGE_TAIL': {
      if (!state.isInitialized) return state;
      const merged = mergeMessagesById(state.messages, action.messages);
      if (merged === state.messages) return state;
      return { ...state, messages: merged };
    }
    case 'PREPEND_OLDER': {
      if (action.messages.length === 0) {
        return {
          ...state,
          hasMoreOlder: action.hasMoreOlder,
          isLoadingOlder: false,
        };
      }
      const merged = [...action.messages, ...state.messages].sort(
        (a, b) => a._creationTime - b._creationTime
      );
      return {
        ...state,
        messages: merged,
        hasMoreOlder: action.hasMoreOlder,
        isLoadingOlder: false,
      };
    }
    case 'APPLY_VISIBLE_UPDATES': {
      if (!state.isInitialized) return state;
      const next = applyVisibleUpdates(state.messages, action.updates);
      if (next === state.messages) return state;
      return { ...state, messages: next };
    }
    case 'REMOVE_BY_TASK_ID': {
      if (!state.isInitialized) return state;
      const next = removeMessagesForTaskId(state.messages, action.taskId);
      if (next.length === state.messages.length) return state;
      return { ...state, messages: next };
    }
    case 'LOAD_OLDER_START':
      return state.isLoadingOlder ? state : { ...state, isLoadingOlder: true };
    case 'LOAD_OLDER_FAILED':
      return { ...state, isLoadingOlder: false };
    case 'TRIM_TO_INITIAL_WINDOW': {
      if (!state.isInitialized) return state;
      const trimmed = trimMessagesToInitialWindow(state.messages);
      if (trimmed.length === state.messages.length) return state;
      const tail = trimmed[trimmed.length - 1];
      if (!tail) return { ...state, messages: trimmed, hasMoreOlder: true };
      return {
        ...state,
        messages: trimmed,
        tailAfterCreationTime: tail._creationTime,
        hasMoreOlder: true,
        isLoadingOlder: false,
      };
    }
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

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
  state: State,
  dispatch: Dispatch<Action>
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
    state.isInitialized && newestSeenCreationTime !== null
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
    state.isInitialized && recentVisibleIds.length > 0
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

export function useChatroomMessageStore(chatroomId: string): UseChatroomMessageStoreResult {
  const typedChatroomId = chatroomId as Id<'chatroom_rooms'>;
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const [state, dispatch] = useReducer(reducer, initialState);
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
    if (state.isInitialized || !sessionId || initialLoadRequested) return;
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
  }, [state.isInitialized, sessionId, convex, typedChatroomId, initialLoadRequested]);

  // ── Reactive delta subscriptions (new-messages tail + visible-message updates) ──
  useTimelineDeltaSubscriptions(typedChatroomId, state, dispatch);

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
