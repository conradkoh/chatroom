'use client';

import type { HarnessTurnView } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  HarnessStreamingChunk,
  HarnessTurnStoreQueries,
  StreamingOverlay,
  StreamingTurnCandidate,
} from './harnessTurnStoreTypes';

function accumulateStreamingOverlay(params: {
  streamingTurn: StreamingTurnCandidate | undefined;
  chunksData: HarnessStreamingChunk[] | undefined;
  overlayTextRef: React.MutableRefObject<string>;
  overlayReasoningRef: React.MutableRefObject<string>;
  mergedIdsRef: React.MutableRefObject<Set<string>>;
  lastMessageIdRef: React.MutableRefObject<string | null>;
}): StreamingOverlay | null {
  const {
    streamingTurn,
    chunksData,
    overlayTextRef,
    overlayReasoningRef,
    mergedIdsRef,
    lastMessageIdRef,
  } = params;

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
}

export function useHarnessTurnStoreStreaming<TScopeId extends string>(params: {
  scopeId: TScopeId;
  scopeArgKey: string;
  queries: HarnessTurnStoreQueries;
  turns: HarnessTurnView[];
}): StreamingOverlay | null {
  const { scopeId, scopeArgKey, queries, turns } = params;

  const streamingTurn = turns.find(
    (t) => t.role === 'assistant' && t.status === 'streaming' && t.messageId
  );

  const [lastCreationTime, setLastCreationTime] = useState(0);
  const overlayTextRef = useRef('');
  const overlayReasoningRef = useRef('');
  const mergedIdsRef = useRef<Set<string>>(new Set());
  const lastMessageIdRef = useRef<string | null>(null);
  const cursorMessageIdRef = useRef<string | null>(null);

  const chunksData = useSessionQuery(
    queries.getStreamingTurnChunks,
    streamingTurn?.messageId
      ? ({
          [scopeArgKey]: scopeId,
          messageId: streamingTurn.messageId,
          afterCreationTime: lastCreationTime,
        } as Record<string, unknown>)
      : 'skip'
  ) as HarnessStreamingChunk[] | undefined;

  const streamingOverlay = useMemo(
    () =>
      accumulateStreamingOverlay({
        streamingTurn,
        chunksData,
        overlayTextRef,
        overlayReasoningRef,
        mergedIdsRef,
        lastMessageIdRef,
      }),
    [streamingTurn, chunksData, overlayTextRef, overlayReasoningRef, mergedIdsRef, lastMessageIdRef]
  );

  // Reset lastCreationTime when scopeId changes (new session/run)
  const prevScopeRef = useRef(scopeId);
  useEffect(() => {
    if (prevScopeRef.current !== scopeId) {
      prevScopeRef.current = scopeId;
      setLastCreationTime(0);
    }
  }, [scopeId]);

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

  return streamingOverlay;
}
