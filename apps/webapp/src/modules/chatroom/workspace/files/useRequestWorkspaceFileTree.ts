'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

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
      }).catch(() => {});
    },
    [enabled, machineId, normalizedWorkingDir, requestMutation]
  );
}
