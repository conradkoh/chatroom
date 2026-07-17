'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { useHarnessTurnStoreCore, type StreamingOverlay } from './useHarnessTurnStoreCore';

export type { StreamingOverlay };

export function useHarnessTurnStore(harnessSessionId: Id<'chatroom_harnessSessions'>) {
  return useHarnessTurnStoreCore({
    scopeId: harnessSessionId,
    scopeArgKey: 'harnessSessionId',
    queries: {
      getLatestTurns: api.web.directHarness.turns.getLatestTurns,
      getTurnsSince: api.web.directHarness.turns.getTurnsSince,
      getOlderTurns: api.web.directHarness.turns.getOlderTurns,
      getStreamingTurnChunks: api.web.directHarness.turns.getStreamingTurnChunks,
    },
    logLabel: 'useHarnessTurnStore',
  });
}
