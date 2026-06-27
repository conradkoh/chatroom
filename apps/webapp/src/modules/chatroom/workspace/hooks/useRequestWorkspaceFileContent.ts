'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useEffect } from 'react';

import { useFileContent } from './useFileContent';

interface WorkspaceFileArgs {
  machineId: string;
  workingDir: string;
  filePath: string;
}

/**
 * Requests file content from the daemon and reactively returns cached content.
 */
export function useRequestWorkspaceFileContent({
  machineId,
  workingDir,
  filePath,
}: WorkspaceFileArgs) {
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    requestContent({ machineId, workingDir, filePath }).catch(() => {});
  }, [machineId, workingDir, filePath, requestContent]);

  return useFileContent({ machineId, workingDir, filePath });
}
