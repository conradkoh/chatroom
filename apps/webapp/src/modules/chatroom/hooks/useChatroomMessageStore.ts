'use client';

/**
 * useChatroomMessageStore — cursor-pinned delta subscription for the timeline.
 *
 * Architecture (matches direct-harness turn store pattern):
 * 1. Initial load — imperative getLatestMessages(limit); pin tailAfterCreationTime
 * 2. Live tail — useSessionQuery(subscribeMessagesSince, { afterCreationTime })
 * 3. Merge — reducer appends/updates by _id; chronological order in store
 * 4. Older pages — imperative listMessagesBefore on scroll-up
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import type { Message } from '../types/message';

import { logLoadOlder } from '../components/timeline/timelineLoadOlderDebug';

export const MESSAGE_STORE_LIMIT = 20;
export const MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE = 20;

/** Match legacy useMessages: a full initial window implies more history may exist. */
export function inferHasMoreOlder(messageCount: number, hasMoreFromServer: boolean): boolean {
  return hasMoreFromServer || messageCount >= MESSAGE_STORE_LIMIT;
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
    attachedWorkflows: m.attachedWorkflows,
    latestProgress: m.latestProgress,
    isQueued: m.isQueued,
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
  | { type: 'RESET' };

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
    case 'LOAD_OLDER_START':
      return state.isLoadingOlder ? state : { ...state, isLoadingOlder: true };
    case 'LOAD_OLDER_FAILED':
      return { ...state, isLoadingOlder: false };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseChatroomMessageStoreResult {
  messages: Message[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: () => void;
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

  // ── Tail subscription (pinned cursor) ─────────────────────────────────────
  const tailData = useSessionQuery(
    api.messageList.subscribeMessagesSince,
    state.isInitialized && state.tailAfterCreationTime !== null
      ? {
          chatroomId: typedChatroomId,
          afterCreationTime: state.tailAfterCreationTime,
        }
      : 'skip'
  );

  useEffect(() => {
    if (!tailData) return;
    dispatch({ type: 'MERGE_TAIL', messages: tailData.map(toMessage) });
  }, [tailData]);

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

  return {
    messages: state.messages,
    isLoading: !state.isInitialized,
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlderMessages,
  };
}
