'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useRef } from 'react';

import { useAgenticQueryRunTurnStore } from '../hooks/useAgenticQueryRunTurnStore';

function AgenticQueryHarnessSyncRunner({
  queryId,
  activeRunId,
}: {
  queryId: Id<'chatroom_agenticQueries'>;
  activeRunId: Id<'chatroom_agenticQueryRuns'>;
}) {
  const syncMutation = useSessionMutation(api.web.agenticQuery.mutations.syncFromHarness);
  const { turns } = useAgenticQueryRunTurnStore(activeRunId);
  const syncingRef = useRef(false);

  useEffect(() => {
    const latestAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
    if (latestAssistant?.status !== 'complete') return;
    if (syncingRef.current) return;

    syncingRef.current = true;
    void syncMutation({ queryId })
      .catch(() => {})
      .finally(() => {
        syncingRef.current = false;
      });
  }, [queryId, syncMutation, turns]);

  return null;
}

/**
 * When a running agentic query's run assistant turn completes, sync query
 * status from run markdown (fallback if daemon idle handler races).
 */
export function AgenticQueryHarnessSync({
  queryId,
  queryStatus,
  activeRunId,
}: {
  queryId: Id<'chatroom_agenticQueries'>;
  queryStatus: string | undefined;
  activeRunId: Id<'chatroom_agenticQueryRuns'> | undefined;
}) {
  if (queryStatus !== 'running' || !activeRunId) return null;
  return <AgenticQueryHarnessSyncRunner queryId={queryId} activeRunId={activeRunId} />;
}
