'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionStatus } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { pruneConfirmedClosedIds } from '../utils/sessionStatus';

interface SessionRow {
  _id: string;
  status: HarnessSessionStatus;
}

export function useOptimisticSessionClose(sessions: SessionRow[] | undefined) {
  const closeSessionMutation = useSessionMutation(api.web.directHarness.commands.closeSession);
  const [optimisticallyClosedIds, setOptimisticallyClosedIds] = useState<Set<string>>(
    () => new Set()
  );
  const [closingIds, setClosingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!sessions || optimisticallyClosedIds.size === 0) return;
    const next = pruneConfirmedClosedIds(optimisticallyClosedIds, sessions);
    if (next) setOptimisticallyClosedIds(next);
  }, [sessions, optimisticallyClosedIds]);

  const closeSession = useCallback(
    async (harnessSessionId: Id<'chatroom_harnessSessions'>) => {
      if (closingIds.has(harnessSessionId) || optimisticallyClosedIds.has(harnessSessionId)) {
        return;
      }

      setOptimisticallyClosedIds((prev) => new Set(prev).add(harnessSessionId));
      setClosingIds((prev) => new Set(prev).add(harnessSessionId));

      try {
        await closeSessionMutation({ harnessSessionId });
      } catch (err) {
        setOptimisticallyClosedIds((prev) => {
          const next = new Set(prev);
          next.delete(harnessSessionId);
          return next;
        });
        throw err;
      } finally {
        setClosingIds((prev) => {
          const next = new Set(prev);
          next.delete(harnessSessionId);
          return next;
        });
      }
    },
    [closeSessionMutation, closingIds, optimisticallyClosedIds]
  );

  return { optimisticallyClosedIds, closingIds, closeSession };
}
