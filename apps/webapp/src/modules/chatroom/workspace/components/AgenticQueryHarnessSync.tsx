'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useRef } from 'react';

import { useHarnessTurnStore } from '@/modules/chatroom/direct-harness/hooks/useHarnessTurnStore';

function AgenticQueryHarnessSyncRunner({
  queryId,
  harnessSessionId,
}: {
  queryId: Id<'chatroom_agenticQueries'>;
  harnessSessionId: Id<'chatroom_harnessSessions'>;
}) {
  const syncMutation = useSessionMutation(api.web.agenticQuery.mutations.syncFromHarness);
  const { turns } = useHarnessTurnStore(harnessSessionId);
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
 * When a running agentic query's harness assistant turn completes, sync query
 * status from harness markdown (fallback if daemon idle handler races).
 */
export function AgenticQueryHarnessSync({
  queryId,
  queryStatus,
  harnessSessionId,
}: {
  queryId: Id<'chatroom_agenticQueries'>;
  queryStatus: string | undefined;
  harnessSessionId: Id<'chatroom_harnessSessions'> | undefined;
}) {
  if (queryStatus !== 'running' || !harnessSessionId) return null;
  return <AgenticQueryHarnessSyncRunner queryId={queryId} harnessSessionId={harnessSessionId} />;
}
