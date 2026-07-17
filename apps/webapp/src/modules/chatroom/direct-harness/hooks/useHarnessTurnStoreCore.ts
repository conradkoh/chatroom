'use client';

import { useConvex } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef, useState, useMemo } from 'react';

import type {
  HarnessTurnView,
  HarnessMessage,
} from '@workspace/backend/src/domain/direct-harness/types';

// ─── State ────────────────────────────────────────────────────────────────────

interface State {
  turns: HarnessTurnView[];
  oldestTurnSeq: number | null;
  tailAfterTurnSeq: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
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
      result[idx] = turn;
    } else {
      result.push(turn);
    }
  }
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
        tailAfterTurnSeq: oldestTurnSeq !== null ? oldestTurnSeq - 1 : 0,
        isInitialized: true,
        hasMoreOlder: hasMore,
      };
    }

    case 'APPEND_OR_UPDATE_TAIL': {
      if (!state.isInitialized) return state;
      const merged = mergeByIdAndAppend(state.turns, action.turns);
      if (merged === state.turns) return state;
      return { ...state, turns: merged };
    }

    case 'PREPEND_OLDER': {
      const { turns, hasMore } = action;
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

// ─── Query Config ───────────────────────────────────────────────────────────────

export interface HarnessTurnStoreConfig<TScopeId extends string> {
  readonly scopeId: TScopeId;
  readonly scopeArgKey: string;
  readonly queries: {
    readonly getLatestTurns: any;
    readonly getTurnsSince: any;
    readonly getOlderTurns: any;
    readonly getStreamingTurnChunks: any;
  };
  readonly logLabel: string;
}

// ─── Streaming Overlay Type ────────────────────────────────────────────────────

export interface StreamingOverlay {
  turnId: string;
  textContent: string;
  reasoningContent: string;
}

// ─── Core Hook ─────────────────────────────────────────────────────────────────

export function useHarnessTurnStoreCore<TScopeId extends string>(
  config: HarnessTurnStoreConfig<TScopeId>
) {
  const { scopeId, scopeArgKey, queries, logLabel } = config;
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sessionId] = useSessionId();
  const convex = useConvex();

  const processedOlderSeqRef = useRef<number | null>(null);

  const prevSessionRef = useRef(scopeId);
  useEffect(() => {
    if (prevSessionRef.current !== scopeId) {
      prevSessionRef.current = scopeId;
      dispatch({ type: 'RESET' });
      processedOlderSeqRef.current = null;
      setInitialLoadRequested(false);
      setLastCreationTime(0);
    }
  }, [scopeId]);

  const [initialLoadRequested, setInitialLoadRequested] = useState(false);

  useEffect(() => {
    if (state.isInitialized || !sessionId || initialLoadRequested) return;
    setInitialLoadRequested(true);

    convex
      .query(queries.getLatestTurns, {
        sessionId,
        [scopeArgKey]: scopeId,
        limit: 50,
      } as Record<string, unknown>)
      .then((data: any) => {
        dispatch({
          type: 'INITIALIZE',
          turns: data.turns as HarnessTurnView[],
          hasMore: data.hasMore,
        });
      })
      .catch((err: unknown) => {
        console.error(`[${logLabel}] Initial load failed:`, err);
        setInitialLoadRequested(false);
      });
  }, [state.isInitialized, sessionId, convex, queries.getLatestTurns, scopeId, scopeArgKey, logLabel, initialLoadRequested]);

  const tailData = useSessionQuery(
    queries.getTurnsSince,
    state.isInitialized && state.tailAfterTurnSeq !== null
      ? ({ [scopeArgKey]: scopeId, afterTurnSeq: state.tailAfterTurnSeq } as Record<string, unknown>)
      : 'skip'
  );

  useEffect(() => {
    if (!tailData || (tailData as HarnessTurnView[]).length === 0) return;
    dispatch({ type: 'APPEND_OR_UPDATE_TAIL', turns: tailData as HarnessTurnView[] });
  }, [tailData]);

  const olderData = useSessionQuery(
    queries.getOlderTurns,
    state.olderQuerySeq != null
      ? ({ [scopeArgKey]: scopeId, beforeTurnSeq: state.olderQuerySeq, limit: 50 } as Record<string, unknown>)
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
      turns: (olderData as any).turns as HarnessTurnView[],
      hasMore: (olderData as any).hasMore,
    });
    processedOlderSeqRef.current = null;
  }, [olderData, state.olderQuerySeq]);

  // ── Streaming turn chunks ───────────────────────────────────────────────
  const streamingTurn = state.turns.find(
    (t) => t.role === 'assistant' && t.status === 'streaming' && t.messageId
  );

  const [lastCreationTime, setLastCreationTime] = useState(0);

  const chunksData = useSessionQuery(
    queries.getStreamingTurnChunks,
    streamingTurn?.messageId
      ? ({ [scopeArgKey]: scopeId, messageId: streamingTurn.messageId, afterCreationTime: lastCreationTime } as Record<string, unknown>)
      : 'skip'
  ) as HarnessMessage[] | undefined;

  const overlayTextRef = useRef('');
  const overlayReasoningRef = useRef('');
  const mergedIdsRef = useRef<Set<string>>(new Set());
  const lastMessageIdRef = useRef<string | null>(null);
  const cursorMessageIdRef = useRef<string | null>(null);

  const streamingOverlay: StreamingOverlay | null = useMemo(() => {
    if (!streamingTurn) {
      overlayTextRef.current = '';
      overlayReasoningRef.current = '';
      mergedIdsRef.current = new Set();
      lastMessageIdRef.current = null;
      return null;
    }

    if (!chunksData) {
      return {
        turnId: streamingTurn._id,
        textContent: overlayTextRef.current,
        reasoningContent: overlayReasoningRef.current,
      };
    }

    const currentMsgId = streamingTurn.messageId ?? null;
    if (lastMessageIdRef.current !== currentMsgId) {
      overlayTextRef.current = '';
      overlayReasoningRef.current = '';
      mergedIdsRef.current = new Set();
      lastMessageIdRef.current = currentMsgId;
    }

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

  useEffect(() => {
    const currentMsgId = streamingTurn?.messageId ?? null;

    if (cursorMessageIdRef.current !== currentMsgId) {
      cursorMessageIdRef.current = currentMsgId;
      setLastCreationTime(0);
    }

    if (!chunksData || chunksData.length === 0) return;

    const maxTime = chunksData.reduce((max, c) => Math.max(max, c._creationTime), 0);
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
