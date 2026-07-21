'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect, useMemo } from 'react';

import { useFileContent } from './useFileContent';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

interface WorkspaceFileArgs {
  machineId: string;
  workingDir: string;
  filePath: string;
  enabled?: boolean;
}

/**
 * Requests file content from the daemon and reactively returns cached content.
 */
export function useRequestWorkspaceFileContent({
  machineId,
  workingDir,
  filePath,
  enabled = true,
}: WorkspaceFileArgs) {
  const normalizedWorkingDir = useMemo(
    () => normalizeWorkspaceWorkingDir(workingDir),
    [workingDir]
  );
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    if (!enabled) return;
    requestContent({ machineId, workingDir: normalizedWorkingDir, filePath }).catch(() => {});
  }, [enabled, machineId, normalizedWorkingDir, filePath, requestContent]);

  return useFileContent(
    enabled ? { machineId, workingDir: normalizedWorkingDir, filePath } : 'skip'
  );
}
