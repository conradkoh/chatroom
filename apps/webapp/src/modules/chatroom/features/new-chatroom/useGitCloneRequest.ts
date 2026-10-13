'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { GIT_CLONE_ERROR_MESSAGES } from '@workspace/shared/domain/git-clone';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

import { deriveGitCloneViewState, type GitCloneViewState } from './lib/deriveGitCloneViewState';
import { messageFromError } from './lib/errorMessage';

/** How often the view re-evaluates timeouts while a request is still active. */
const GIT_CLONE_TICK_MS = 5_000;

/** Completed and failed requests are final. Only the others still need timeout ticks. */
const FINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed']);

type CloneRequestId = Id<'chatroom_gitCloneRequests'>;

export interface UseGitCloneRequestResult {
  start: (machineId: string, repoUrl: string, targetPath: string) => Promise<void>;
  requestId: CloneRequestId | null;
  viewState: GitCloneViewState;
  reset: () => void;
}

function isFinal(request: { status: string } | null | undefined): boolean {
  return request ? FINAL_STATUSES.has(request.status) : false;
}

/** A request is active once started and until it reaches a final status. */
function isRequestActive(
  requestId: CloneRequestId | null,
  request: { status: string } | null | undefined
): boolean {
  return requestId !== null && !isFinal(request);
}

/** Re-renders on a timer while `active`, so timeouts are re-checked. `refresh` takes a fresh reading. */
function useClock(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), GIT_CLONE_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  const refresh = useCallback(() => setNow(Date.now()), []);
  return { now, refresh };
}

/** The view state for a request that could not be started, such as an invalid URL or path. */
function startFailureState(detail: string): GitCloneViewState {
  return {
    kind: 'failed',
    errorCode: 'invalid_request',
    message: GIT_CLONE_ERROR_MESSAGES.invalid_request,
    detail,
  };
}

/**
 * Starts a daemon clone and follows its status. Failing to start (an invalid URL or path) is shown
 * as an `invalid_request` failure rather than thrown, so the form can keep its inputs.
 */
export function useGitCloneRequest({
  isMachineConnected,
}: {
  isMachineConnected: boolean;
}): UseGitCloneRequestResult {
  const requestClone = useSessionMutation(api.gitCloneRequests.request);
  const [requestId, setRequestId] = useState<CloneRequestId | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const request = useSessionQuery(api.gitCloneRequests.get, requestId ? { requestId } : 'skip');
  const { now, refresh } = useClock(isRequestActive(requestId, request));

  const start = useCallback(
    async (machineId: string, repoUrl: string, targetPath: string) => {
      setStartError(null);
      refresh();
      try {
        const result = await requestClone({ machineId, repoUrl, targetPath });
        setRequestId(result.requestId);
      } catch (error) {
        setStartError(messageFromError(error, GIT_CLONE_ERROR_MESSAGES.invalid_request));
      }
    },
    [requestClone, refresh]
  );

  const reset = useCallback(() => {
    setRequestId(null);
    setStartError(null);
  }, []);

  const viewState =
    startError !== null
      ? startFailureState(startError)
      : deriveGitCloneViewState(request, now, isMachineConnected, requestId !== null);

  return { start, requestId, viewState, reset };
}
