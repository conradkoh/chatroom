'use client';

import { useConvex } from 'convex/react';
import { useSessionQuery, useSessionId } from 'convex-helpers/react/sessions';
import { useReducer, useEffect, useCallback, useRef, useState } from 'react';

import { harnessTurnStoreInitialState, harnessTurnStoreReducer } from './harnessTurnStoreReducer';
import type {
  HarnessTurnStoreConfig,
  HarnessLatestTurnsPage,
  HarnessOlderTurnsPage,
  HarnessTurnsSincePage,
} from './harnessTurnStoreTypes';
import { useHarnessTurnStoreStreaming } from './useHarnessTurnStoreStreaming';

export type { HarnessTurnStoreConfig } from './harnessTurnStoreTypes';

export function useHarnessTurnStoreCore<TScopeId extends string>(
  config: HarnessTurnStoreConfig<TScopeId>
) {
  const { scopeId, scopeArgKey, queries, logLabel } = config;
  const [state, dispatch] = useReducer(harnessTurnStoreReducer, harnessTurnStoreInitialState);
  const [sessionId] = useSessionId();
  const convex = useConvex();
  const processedOlderSeqRef = useRef<number | null>(null);
  const [initialLoadRequested, setInitialLoadRequested] = useState(false);

  const prevSessionRef = useRef(scopeId);
  useEffect(() => {
    if (prevSessionRef.current !== scopeId) {
      prevSessionRef.current = scopeId;
      dispatch({ type: 'RESET' });
      processedOlderSeqRef.current = null;
      setInitialLoadRequested(false);
    }
  }, [scopeId]);

  useEffect(() => {
    if (state.isInitialized || !sessionId || initialLoadRequested) return;
    setInitialLoadRequested(true);

    convex
      .query(queries.getLatestTurns, {
        sessionId,
        [scopeArgKey]: scopeId,
        limit: 50,
      } as Record<string, unknown>)
      .then((data: HarnessLatestTurnsPage) => {
        dispatch({ type: 'INITIALIZE', turns: data.turns, hasMore: data.hasMore });
      })
      .catch((err: unknown) => {
        console.error(`[${logLabel}] Initial load failed:`, err);
        setInitialLoadRequested(false);
      });
  }, [
    state.isInitialized,
    sessionId,
    convex,
    queries.getLatestTurns,
    scopeId,
    scopeArgKey,
    logLabel,
    initialLoadRequested,
  ]);

  const tailData = useSessionQuery(
    queries.getTurnsSince,
    state.isInitialized && state.tailAfterTurnSeq !== null
      ? ({ [scopeArgKey]: scopeId, afterTurnSeq: state.tailAfterTurnSeq } as Record<
          string,
          unknown
        >)
      : 'skip'
  ) as HarnessTurnsSincePage | undefined;

  useEffect(() => {
    if (!tailData || tailData.length === 0) return;
    dispatch({ type: 'APPEND_OR_UPDATE_TAIL', turns: tailData });
  }, [tailData]);

  const olderData = useSessionQuery(
    queries.getOlderTurns,
    state.olderQuerySeq != null
      ? ({ [scopeArgKey]: scopeId, beforeTurnSeq: state.olderQuerySeq, limit: 50 } as Record<
          string,
          unknown
        >)
      : 'skip'
  ) as HarnessOlderTurnsPage | undefined;

  useEffect(() => {
    if (
      !olderData ||
      state.olderQuerySeq == null ||
      processedOlderSeqRef.current === state.olderQuerySeq
    )
      return;
    processedOlderSeqRef.current = state.olderQuerySeq;
    dispatch({ type: 'PREPEND_OLDER', turns: olderData.turns, hasMore: olderData.hasMore });
    processedOlderSeqRef.current = null;
  }, [olderData, state.olderQuerySeq]);

  const streamingOverlay = useHarnessTurnStoreStreaming({
    scopeId,
    scopeArgKey,
    queries,
    turns: state.turns,
  });

  const loadOlderMessages = useCallback(() => dispatch({ type: 'REQUEST_OLDER' }), []);

  return {
    turns: state.turns,
    isLoading: !state.isInitialized,
    hasMoreOlder: state.hasMoreOlder,
    isLoadingOlder: state.isLoadingOlder,
    loadOlderMessages,
    streamingOverlay,
  };
}
