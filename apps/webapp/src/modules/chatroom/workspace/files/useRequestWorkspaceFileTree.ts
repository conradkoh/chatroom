'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

export function useRequestWorkspaceFileTree({
  machineId,
  workingDir,
  enabled = true,
}: {
  machineId: string;
  workingDir: string;
  enabled?: boolean;
}): (force: boolean) => void {
  const normalizedWorkingDir = normalizeWorkspaceWorkingDir(workingDir);
  const requestMutation = useSessionMutation(api.workspaceFiles.requestFileTree);

  return useCallback(
    (force: boolean) => {
      if (!enabled) return;
      requestMutation({
        machineId,
        workingDir: normalizedWorkingDir,
        ...(force ? { force: true } : {}),
      }).catch((err: unknown) => {
        if (process.env.NODE_ENV === 'development')
          console.warn('[workspace] requestFileTree failed:', err);
        toast.error(
          err instanceof Error ? err.message : 'Failed to request workspace file tree sync'
        );
      });
    },
    [enabled, machineId, normalizedWorkingDir, requestMutation]
  );
}
