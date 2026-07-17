// fallow-ignore-file code-duplication complexity
'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type {
  HarnessTurnView,
  HarnessMessage,
} from '@workspace/backend/src/domain/direct-harness/types';
import { useConvex } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef, useState, useMemo } from 'react';

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

export function useAgenticQueryRunTurnStore(runId: Id<'chatroom_agenticQueryRuns'>) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sessionId] = useSessionId();
  const convex = useConvex();

  // Prevents re-processing the same older-load cursor twice.
  const processedOlderSeqRef = useRef<number | null>(null);

  // ── Reset when the session changes ──────────────────────────────────────
  const prevSessionRef = useRef(runId);
  useEffect(() => {
    if (prevSessionRef.current !== runId) {
      prevSessionRef.current = runId;
      dispatch({ type: 'RESET' });
      processedOlderSeqRef.current = null;
      setInitialLoadRequested(false);
      setLastCreationTime(0);
    }
  }, [runId]);

  // ── Initial load (one-shot, not reactive) ───────────────────────────────
  const [initialLoadRequested, setInitialLoadRequested] = useState(false);

  useEffect(() => {
    if (state.isInitialized || !sessionId || initialLoadRequested) return;
    setInitialLoadRequested(true);

    convex
      .query(api.web.agenticQuery.index.getLatestTurns, {
        sessionId,
        runId,
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
        console.error('[useAgenticQueryRunTurnStore] Initial load failed:', err);
        setInitialLoadRequested(false);
      });
  }, [state.isInitialized, sessionId, convex, runId, initialLoadRequested]);

  // ── Tail subscription (reactive, pinned cursor) ─────────────────────────
  // Fires when turns are inserted OR when existing turns in the window are
  // updated (status changes like pending→streaming→complete).
  const tailData = useSessionQuery(
    api.web.agenticQuery.index.getTurnsSince,
    state.isInitialized && state.tailAfterTurnSeq !== null
      ? { runId, afterTurnSeq: state.tailAfterTurnSeq }
      : 'skip'
  );

  useEffect(() => {
    if (!tailData || tailData.length === 0) return;
    dispatch({ type: 'APPEND_OR_UPDATE_TAIL', turns: tailData as HarnessTurnView[] });
  }, [tailData]);

  // ── Older turns (on-demand) ─────────────────────────────────────────────
  const olderData = useSessionQuery(
    api.web.agenticQuery.index.getOlderTurns,
    state.olderQuerySeq != null ? { runId, beforeTurnSeq: state.olderQuerySeq, limit: 50 } : 'skip'
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

  // Cursor: tracks the highest _creationTime chunk already merged into the
  // overlay. Passed to getStreamingTurnChunks so each Convex push delivers
  // only the delta (gte boundary) instead of the full latest-N backlog.
  // useState (not useRef) so changing it causes a re-render → Convex
  // resubscribes with the updated lower bound.
  const [lastCreationTime, setLastCreationTime] = useState(0);

  const chunksData = useSessionQuery(
    api.web.agenticQuery.index.getStreamingTurnChunks,
    streamingTurn?.messageId
      ? { runId, messageId: streamingTurn.messageId, afterCreationTime: lastCreationTime }
      : 'skip'
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
  // Tracks the messageId for which lastCreationTime was last reset/advanced.
  // Separate from lastMessageIdRef (which drives the overlay reset) so the
  // two concerns remain decoupled.
  const cursorMessageIdRef = useRef<string | null>(null);

  // Derive streaming overlay (computed, not stored in state)
  const streamingOverlay: StreamingOverlay | null = useMemo(() => {
    if (!streamingTurn) {
      // True "no active streaming turn" — reset all accumulator state.
      overlayTextRef.current = '';
      overlayReasoningRef.current = '';
      mergedIdsRef.current = new Set();
      lastMessageIdRef.current = null;
      return null;
    }

    if (!chunksData) {
      // Transient: useSessionQuery returns undefined while the cursor-driven
      // resubscription is in flight. Do NOT reset accumulator state — hold
      // what we have and return the previous overlay so the UI stays stable.
      // Without this guard, every cursor advance would briefly wipe the
      // overlay and the next push (containing only the gte-boundary chunk)
      // would render as a single token, producing a "one-token-at-a-time"
      // flicker.
      return {
        turnId: streamingTurn._id,
        textContent: overlayTextRef.current,
        reasoningContent: overlayReasoningRef.current,
      };
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

  // ── Advance / reset the streaming cursor ───────────────────────────────
  // Runs after each Convex push (chunksData changes) and after each render
  // where the streaming messageId changes.
  //
  // Why useEffect (not useMemo): setState must not be called during render.
  // This effect fires after the DOM has committed, advancing lastCreationTime
  // so the next Convex subscription uses the updated lower bound.
  //
  // Reset path (messageId changed): setLastCreationTime(0) is called first;
  // then the advancement runs immediately below with the current chunks so
  // the cursor reaches the right level in one render cycle instead of two.
  // React 18 batches both calls: the functional updater sees prev=0, so the
  // result is max(0, newChunksMax) = newChunksMax. This is always ≤ the
  // old cursor (2000 → newChunksMax), satisfying the reset contract.
  useEffect(() => {
    const currentMsgId = streamingTurn?.messageId ?? null;

    if (cursorMessageIdRef.current !== currentMsgId) {
      // messageId changed (or first mount) — reset cursor.
      // Do NOT return early: fall through so the cursor immediately advances
      // from the chunks already in chunksData for this messageId, saving a
      // round-trip render cycle.
      cursorMessageIdRef.current = currentMsgId;
      setLastCreationTime(0);
    }

    if (!chunksData || chunksData.length === 0) return;

    const maxTime = chunksData.reduce((max, c) => Math.max(max, c._creationTime), 0);
    // Functional update: prev is 0 if we just reset above (React batches both
    // calls), so the result is maxTime — correct for both advance and reset paths.
    setLastCreationTime((prev) => (maxTime > prev ? maxTime : prev));
  }, [chunksData, streamingTurn?.messageId]);

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
