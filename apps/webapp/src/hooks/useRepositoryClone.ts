'use client';

// The request lifecycle intentionally mirrors the existing folder-picker hook.
// fallow-ignore-file code-duplication

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

/** Matches the daemon command TTL for repository clone requests. */
const CLONE_TIMEOUT_MS = 5 * 60_000;

// This hook coordinates timeout and request state for the asynchronous daemon request.
// fallow-ignore-next-line complexity
export function useRepositoryClone() {
  const requestRepositoryClone = useSessionMutation(api.machines.requestRepositoryClone);
  const [requestId, setRequestId] = useState<Id<'chatroom_repositoryCloneRequests'> | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  const request = useSessionQuery(
    api.machines.getRepositoryCloneRequest,
    requestId ? { requestId } : 'skip'
  );

  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!requestId || !request || request.status !== 'pending') {
      setIsTimedOut(false);
      return;
    }

    const remaining = CLONE_TIMEOUT_MS - (Date.now() - request.createdAt);
    if (remaining <= 0) {
      setIsTimedOut(true);
      return;
    }

    const timer = setTimeout(() => setIsTimedOut(true), remaining);
    return () => clearTimeout(timer);
  }, [requestId, request]);

  const requestClone = useCallback(
    async (machineId: string, githubUrl: string) => {
      setIsTimedOut(false);
      const result = await requestRepositoryClone({ machineId, githubUrl });
      setRequestId(result.requestId);
      return result.requestId;
    },
    [requestRepositoryClone]
  );

  const reset = useCallback(() => {
    setRequestId(null);
    setIsTimedOut(false);
  }, []);

  const isPending = Boolean(requestId && (!request || request.status === 'pending') && !isTimedOut);

  return { requestClone, request, requestId, reset, isPending, isTimedOut };
}
