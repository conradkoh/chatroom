'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import {
  useHarnessTurnStoreCore,
  type StreamingOverlay,
} from '@/modules/chatroom/direct-harness/hooks/useHarnessTurnStoreCore';

export type { StreamingOverlay };

export function useAgenticQueryRunTurnStore(runId: Id<'chatroom_agenticQueryRuns'>) {
  return useHarnessTurnStoreCore({
    scopeId: runId,
    scopeArgKey: 'runId',
    queries: {
      getLatestTurns: api.web.agenticQuery.index.getLatestTurns,
      getTurnsSince: api.web.agenticQuery.index.getTurnsSince,
      getOlderTurns: api.web.agenticQuery.index.getOlderTurns,
      getStreamingTurnChunks: api.web.agenticQuery.index.getStreamingTurnChunks,
    },
    logLabel: 'useAgenticQueryRunTurnStore',
  });
}
