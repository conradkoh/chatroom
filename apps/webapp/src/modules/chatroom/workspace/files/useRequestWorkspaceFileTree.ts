'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

/**
 * Feedback sink for tree-sync requests. The hook never renders; the owner decides where
 * the text appears. Omit it where there is no feedback surface. Both callbacks must be
 * referentially stable, because the hook's returned function is an effect dependency.
 */
export interface WorkspaceTreeSyncFeedback {
  /** Runs before each enabled request is sent. The owner clears its previous failure here. */
  onAttempt?: () => void;
  /** Runs once when a request rejects, with the failure text. */
  onError?: (message: string) => void;
}

export function useRequestWorkspaceFileTree({
  machineId,
  workingDir,
  enabled = true,
  treeSyncFeedback,
}: {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
  treeSyncFeedback?: WorkspaceTreeSyncFeedback;
}): (force: boolean) => void {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);
  const onAttempt = treeSyncFeedback?.onAttempt;
  const onError = treeSyncFeedback?.onError;

  return useCallback(
    (force: boolean) => {
      if (!enabled) return;
      onAttempt?.();
      requestMutation({
        machineId,
        workingDir: normalizedWorkingDir,
        ...(force ? { force: true } : {}),
      }).catch((err: unknown) => {
        // No sink (dashboard autocomplete): dropped on purpose; no feedback surface, not actionable.
        if (process.env.NODE_ENV === 'development')
          console.warn('[workspace] requestFileTree failed:', err);
        onError?.(
          err instanceof Error ? err.message : 'Failed to request workspace file tree sync'
        );
      });
    },
    [enabled, machineId, normalizedWorkingDir, onAttempt, onError, requestMutation]
  );
}
