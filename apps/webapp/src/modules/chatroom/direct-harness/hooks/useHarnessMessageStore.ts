'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef, useState } from 'react';

import type { HarnessMessage } from './useSubscribeMessages';

export type { HarnessMessage };

// ─── State ────────────────────────────────────────────────────────────────────

interface State {
  messages: HarnessMessage[];
  /** seq of the oldest message currently in memory (for pagination). */
  oldestSeq: number | null;
  /**
   * seq of the newest message in memory.
   * Used as the APPEND_DELTA guard — only messages with seq > newestSeq are
   * accepted from the tail subscription to prevent stale re-evaluations from
   * re-adding already-visible messages.
   */
  newestSeq: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  /** When non-null, triggers the getOlderMessages query for this seq. */
  olderQuerySeq: number | null;
}

const initialState: State = {
  messages: [],
  oldestSeq: null,
  newestSeq: null,
  isInitialized: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
  olderQuerySeq: null,
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'INITIALIZE'; messages: HarnessMessage[]; newestSeq: number; hasMore: boolean }
  | { type: 'APPEND_DELTA'; messages: HarnessMessage[] }
  | { type: 'PREPEND_OLDER'; messages: HarnessMessage[]; hasMore: boolean }
  | { type: 'REQUEST_OLDER' }
  | { type: 'RESET' };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function dedup(existing: HarnessMessage[], incoming: HarnessMessage[]): HarnessMessage[] {
  const ids = new Set(existing.map((m) => m._id));
  return incoming.filter((m) => !ids.has(m._id));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INITIALIZE': {
      if (state.isInitialized) return state;
      const { messages, newestSeq, hasMore } = action;
      return {
        ...state,
        messages,
        oldestSeq: messages[0]?.seq ?? null,
        newestSeq,
        isInitialized: true,
        hasMoreOlder: hasMore,
      };
    }

    case 'APPEND_DELTA': {
      // Guard: store must be initialized and newestSeq set.
      if (!state.isInitialized || state.newestSeq === null) return state;
      // Only accept messages newer than what we already have.
      const incoming = dedup(state.messages, action.messages).filter(
        (m) => m.seq > state.newestSeq!
      );
      if (incoming.length === 0) return state;
      const merged = [...state.messages, ...incoming];
      return {
        ...state,
        messages: merged,
        newestSeq: merged[merged.length - 1].seq,
      };
    }

    case 'PREPEND_OLDER': {
      const { messages, hasMore } = action;
      const newOnes = dedup(state.messages, messages);
      if (newOnes.length === 0) {
        return { ...state, hasMoreOlder: hasMore, isLoadingOlder: false, olderQuerySeq: null };
      }
      const merged = [...newOnes, ...state.messages];
      return {
        ...state,
        messages: merged,
        oldestSeq: merged[0].seq,
        hasMoreOlder: hasMore,
        isLoadingOlder: false,
        olderQuerySeq: null,
      };
    }

    case 'REQUEST_OLDER': {
      if (state.isLoadingOlder || !state.hasMoreOlder || state.oldestSeq === null) return state;
      return { ...state, isLoadingOlder: true, olderQuerySeq: state.oldestSeq };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHarnessMessageStore(harnessSessionId: Id<'chatroom_harnessSessions'>) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sessionId] = useSessionId();
  const convex = useConvex();

  /**
   * Pinned tail cursor — set once after the initial load and never changed.
   * This keeps the getMessagesSince subscription args stable, ensuring Convex
   * only evaluates the query against the tail rather than the full history.
   */
  const tailSeqRef = useRef<number>(0);

  // Prevents re-processing the same older-load cursor twice.
  const processedOlderSeqRef = useRef<number | null>(null);

  // ── Reset when the session changes ──────────────────────────────────────
  const prevSessionRef = useRef(harnessSessionId);
  useEffect(() => {
    if (prevSessionRef.current !== harnessSessionId) {
      prevSessionRef.current = harnessSessionId;
      dispatch({ type: 'RESET' });
      tailSeqRef.current = 0;
      processedOlderSeqRef.current = null;
      setInitialLoadRequested(false);
    }
  }, [harnessSessionId]);

  // ── Initial load (one-shot, not reactive) ───────────────────────────────
  // Uses the imperative convex.query() rather than useQuery so no reactive
  // subscription is established — the tail subscription handles live updates.
  const [initialLoadRequested, setInitialLoadRequested] = useState(false);

  useEffect(() => {
    if (state.isInitialized || !sessionId || initialLoadRequested) return;
    setInitialLoadRequested(true);

    convex
      .query(api.web.directHarness.messages.getLatestMessages, {
        sessionId,
        harnessSessionId,
        limit: 50,
      })
      .then((data) => {
        tailSeqRef.current = data.newestSeq;
        dispatch({
          type: 'INITIALIZE',
          messages: data.messages as HarnessMessage[],
          newestSeq: data.newestSeq,
          hasMore: data.hasMore,
        });
      })
      .catch((err: unknown) => {
        console.error('[useHarnessMessageStore] Initial load failed:', err);
        setInitialLoadRequested(false);
      });
  }, [state.isInitialized, sessionId, convex, harnessSessionId, initialLoadRequested]);

  // ── Tail subscription (reactive, pinned cursor) ─────────────────────────
  // Skipped until initialized. afterSeq is derived from tailSeqRef.current which
  // is set once and never changes, keeping the subscription args stable.
  const tailData = useSessionQuery(
    api.web.directHarness.messages.getMessagesSince,
    state.isInitialized ? { harnessSessionId, afterSeq: tailSeqRef.current } : 'skip'
  );

  useEffect(() => {
    if (!tailData || tailData.length === 0) return;
    dispatch({ type: 'APPEND_DELTA', messages: tailData as HarnessMessage[] });
  }, [tailData]);

  // ── Older messages (on-demand) ──────────────────────────────────────────
  const olderData = useSessionQuery(
    api.web.directHarness.messages.getOlderMessages,
    state.olderQuerySeq != null
      ? { harnessSessionId, beforeSeq: state.olderQuerySeq, limit: 50 }
      : 'skip'
  );

  useEffect(() => {
    if (
      !olderData ||
      state.olderQuerySeq == null ||
      processedOlderSeqRef.current === state.olderQuerySeq
    ) {
      return;
    }
    processedOlderSeqRef.current = state.olderQuerySeq;
    dispatch({
      type: 'PREPEND_OLDER',
      messages: olderData.messages as HarnessMessage[],
      hasMore: olderData.hasMore,
    });
    // Clear the ref so a subsequent click with the same oldestSeq (e.g., when
    // the prior fetch returned only duplicates and oldestSeq didn't advance) is
    // processed rather than silently suppressed by the guard above.
    processedOlderSeqRef.current = null;
  }, [olderData, state.olderQuerySeq]);

  // ── Public API ───────────────────────────────────────────────────────────

  const loadOlderMessages = useCallback(() => {
    dispatch({ type: 'REQUEST_OLDER' });
  }, []);

  return {
    messages: state.messages,
    isLoading: !state.isInitialized,
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlderMessages,
  };
}
