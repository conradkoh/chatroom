/**
 * useActiveRunOutput — demand-driven subscription for command run output.
 *
 * Each consumer independently calls this hook when it needs live output.
 * Convex deduplicates identical queries client-side, so multiple consumers
 * subscribing to the same `runId` cause only one backend subscription.
 * When all consumers unmount (or pass `null`), the query unsubscribes.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';

export function useActiveRunOutput(activeRunId: string | null) {
  const result = useSessionQuery(
    api.commands.getRunOutput,
    activeRunId ? { runId: activeRunId as any } : 'skip'
  );
  return result ?? { chunks: [], run: null };
}
