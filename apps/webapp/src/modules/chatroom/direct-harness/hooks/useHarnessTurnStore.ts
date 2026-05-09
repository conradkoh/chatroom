'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef, useState, useMemo } from 'react';

import type {
  HarnessTurnView,
  HarnessMessage,
} from '@workspace/backend/src/domain/direct-harness/types';

export type { HarnessTurnView };

// ─── State ────────────────────────────────────────────────────────────────────

interface State {
  turns: HarnessTurnView[];
  /** turnSeq of the oldest turn in memory (for pagination). */
  oldestTurnSeq: number | null;
  /**
   * turnSeq pinned after initial load. Used as the lower bound for the
   * getTurnsSince tail subscription (afterTurnSeq = oldestTurnSeq - 1).
   * This delivers both new turns and status updates on visible turns.
   */
  tailAfterTurnSeq: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  /** When non-null, triggers the getOlderTurns query for this seq. */
  olderQuerySeq: number | null;
}

const initialState: State = {
  turns: [],
  oldestTurnSeq: null,
  tailAfterTurnSeq: null,
  isInitialized: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
  olderQuerySeq: null,
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'INITIALIZE'; turns: HarnessTurnView[]; hasMore: boolean }
  | { type: 'APPEND_OR_UPDATE_TAIL'; turns: HarnessTurnView[] }
  | { type: 'PREPEND_OLDER'; turns: HarnessTurnView[]; hasMore: boolean }
  | { type: 'REQUEST_OLDER' }
  | { type: 'RESET' };

// ─── Reducer ──────────────────────────────────────────────────────────────────

function mergeByIdAndAppend(
  existing: HarnessTurnView[],
  incoming: HarnessTurnView[]
): HarnessTurnView[] {
  if (incoming.length === 0) return existing;
  const idxById = new Map(existing.map((t, i) => [t._id, i]));
  const result = [...existing];
  for (const turn of incoming) {
    const idx = idxById.get(turn._id);
    if (idx !== undefined) {
      result[idx] = turn; // Replace updated row (e.g., status changed)
    } else {
      result.push(turn); // New turn
    }
  }
  // Keep sorted by turnSeq
  result.sort((a, b) => a.turnSeq - b.turnSeq);
  return result;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INITIALIZE': {
      if (state.isInitialized) return state;
      const { turns, hasMore } = action;
      const oldestTurnSeq = turns[0]?.turnSeq ?? null;
      return {
        ...state,
        turns,
        oldestTurnSeq,
        // Subscribe from just before the oldest visible turn so we get status
        // updates on visible turns AND all new turns.
        tailAfterTurnSeq: oldestTurnSeq !== null ? oldestTurnSeq - 1 : 0,
        isInitialized: true,
        hasMoreOlder: hasMore,
      };
    }

    case 'APPEND_OR_UPDATE_TAIL': {
      if (!state.isInitialized) return state;
      const merged = mergeByIdAndAppend(state.turns, action.turns);
      if (merged === state.turns) return state;
      return {
        ...state,
        turns: merged,
      };
    }

    case 'PREPEND_OLDER': {
      const { turns, hasMore } = action;
      // Remove items that already exist in state
      const existingIds = new Set(state.turns.map((t) => t._id));
      const newOnes = turns.filter((t) => !existingIds.has(t._id));
      if (newOnes.length === 0) {
        return { ...state, hasMoreOlder: hasMore, isLoadingOlder: false, olderQuerySeq: null };
      }
      const merged = [...newOnes, ...state.turns].sort((a, b) => a.turnSeq - b.turnSeq);
      return {
        ...state,
        turns: merged,
        oldestTurnSeq: merged[0]?.turnSeq ?? null,
        hasMoreOlder: hasMore,
        isLoadingOlder: false,
        olderQuerySeq: null,
      };
    }

    case 'REQUEST_OLDER': {
      if (state.isLoadingOlder || !state.hasMoreOlder || state.oldestTurnSeq === null) return state;
      return { ...state, isLoadingOlder: true, olderQuerySeq: state.oldestTurnSeq };
    }

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface StreamingOverlay {
  turnId: Id<'chatroom_harnessSessionTurns'>;
  textContent: string;
  reasoningContent: string;
}

export function useHarnessTurnStore(harnessSessionId: Id<'chatroom_harnessSessions'>) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sessionId] = useSessionId();
  const convex = useConvex();

  // Prevents re-processing the same older-load cursor twice.
  const processedOlderSeqRef = useRef<number | null>(null);

  // ── Reset when the session changes ──────────────────────────────────────
  const prevSessionRef = useRef(harnessSessionId);
  useEffect(() => {
    if (prevSessionRef.current !== harnessSessionId) {
      prevSessionRef.current = harnessSessionId;
      dispatch({ type: 'RESET' });
      processedOlderSeqRef.current = null;
      setInitialLoadRequested(false);
    }
  }, [harnessSessionId]);

  // ── Initial load (one-shot, not reactive) ───────────────────────────────
  const [initialLoadRequested, setInitialLoadRequested] = useState(false);

  useEffect(() => {
    if (state.isInitialized || !sessionId || initialLoadRequested) return;
    setInitialLoadRequested(true);

    convex
      .query(api.web.directHarness.turns.getLatestTurns, {
        sessionId,
        harnessSessionId,
        limit: 50,
      })
      .then((data) => {
        dispatch({
          type: 'INITIALIZE',
          turns: data.turns as HarnessTurnView[],
          hasMore: data.hasMore,
        });
      })
      .catch((err: unknown) => {
        console.error('[useHarnessTurnStore] Initial load failed:', err);
        setInitialLoadRequested(false);
      });
  }, [state.isInitialized, sessionId, convex, harnessSessionId, initialLoadRequested]);

  // ── Tail subscription (reactive, pinned cursor) ─────────────────────────
  // Fires when turns are inserted OR when existing turns in the window are
  // updated (status changes like pending→streaming→complete).
  const tailData = useSessionQuery(
    api.web.directHarness.turns.getTurnsSince,
    state.isInitialized && state.tailAfterTurnSeq !== null
      ? { harnessSessionId, afterTurnSeq: state.tailAfterTurnSeq }
      : 'skip'
  );

  useEffect(() => {
    if (!tailData || tailData.length === 0) return;
    dispatch({ type: 'APPEND_OR_UPDATE_TAIL', turns: tailData as HarnessTurnView[] });
  }, [tailData]);

  // ── Older turns (on-demand) ─────────────────────────────────────────────
  const olderData = useSessionQuery(
    api.web.directHarness.turns.getOlderTurns,
    state.olderQuerySeq != null
      ? { harnessSessionId, beforeTurnSeq: state.olderQuerySeq, limit: 50 }
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
      turns: olderData.turns as HarnessTurnView[],
      hasMore: olderData.hasMore,
    });
    processedOlderSeqRef.current = null;
  }, [olderData, state.olderQuerySeq]);

  // ── Streaming turn chunks ───────────────────────────────────────────────
  // Find the current streaming turn (if any). Only subscribe to its chunks
  // when it has a bound messageId (daemon has started writing).
  const streamingTurn = state.turns.find(
    (t) => t.role === 'assistant' && t.status === 'streaming' && t.messageId
  );

  const chunksData = useSessionQuery(
    api.web.directHarness.turns.getStreamingTurnChunks,
    streamingTurn?.messageId ? { harnessSessionId, messageId: streamingTurn.messageId } : 'skip'
  ) as HarnessMessage[] | undefined;

  // Incremental overlay accumulation.
  // Refs hold mutable state that persists across renders without triggering
  // re-renders. mergedIdsRef tracks chunk._id values already appended —
  // correct even when _creationTime is shared across inserts in the same
  // Convex mutation. When the messageId changes (new turn), refs reset.
  const overlayTextRef = useRef('');
  const overlayReasoningRef = useRef('');
  const mergedIdsRef = useRef<Set<string>>(new Set());
  const lastMessageIdRef = useRef<string | null>(null);

  // Derive streaming overlay (computed, not stored in state)
  const streamingOverlay: StreamingOverlay | null = useMemo(() => {
    if (!streamingTurn || !chunksData) {
      // No active streaming turn — reset accumulator
      overlayTextRef.current = '';
      overlayReasoningRef.current = '';
      mergedIdsRef.current = new Set();
      lastMessageIdRef.current = null;
      return null;
    }

    // Reset accumulator when the turn changes (new messageId)
    const currentMsgId = streamingTurn.messageId ?? null;
    if (lastMessageIdRef.current !== currentMsgId) {
      overlayTextRef.current = '';
      overlayReasoningRef.current = '';
      mergedIdsRef.current = new Set();
      lastMessageIdRef.current = currentMsgId;
    }

    // Append only chunks not yet in the merged set (keyed by _id, which is
    // always unique). This handles _creationTime collisions that occur when
    // multiple inserts share a mutation (Convex does not guarantee per-insert
    // _creationTime uniqueness within a mutation).
    for (const chunk of chunksData) {
      if (!mergedIdsRef.current.has(chunk._id as string)) {
        if (chunk.partType === 'reasoning') {
          overlayReasoningRef.current += chunk.content;
        } else {
          overlayTextRef.current += chunk.content;
        }
        mergedIdsRef.current.add(chunk._id as string);
      }
    }

    return {
      turnId: streamingTurn._id,
      textContent: overlayTextRef.current,
      reasoningContent: overlayReasoningRef.current,
    };
  }, [streamingTurn, chunksData]);

  // ── Public API ───────────────────────────────────────────────────────────

  const loadOlderMessages = useCallback(() => {
    dispatch({ type: 'REQUEST_OLDER' });
  }, []);

  return {
    turns: state.turns,
    isLoading: !state.isInitialized,
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlderMessages,
    streamingOverlay,
  };
}
