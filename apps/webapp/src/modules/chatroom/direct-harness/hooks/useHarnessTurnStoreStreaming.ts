'use client';

import type { HarnessTurnView } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo, useRef } from 'react';

import type {
  HarnessStreamingChunk,
  HarnessTurnStoreQueries,
  StreamingOverlay,
  StreamingTurnCandidate,
} from '../stores/harnessTurnStoreTypes';

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

  const overlayTextRef = useRef('');
  const overlayReasoningRef = useRef('');
  const mergedIdsRef = useRef<Set<string>>(new Set());
  const lastMessageIdRef = useRef<string | null>(null);

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
  const lastCreationTime = useMemo(
    () => chunksData?.reduce((max, chunk) => Math.max(max, chunk._creationTime), 0) ?? 0,
    [chunksData]
  );

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

  return streamingOverlay;
}
