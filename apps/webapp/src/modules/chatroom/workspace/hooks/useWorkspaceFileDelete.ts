'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';

interface UseWorkspaceFileDeleteArgs {
  machineId: string;
  workingDir: string;
}

export function useWorkspaceFileDelete({ machineId, workingDir }: UseWorkspaceFileDeleteArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);
  const inFlightRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteFile = useCallback(
    async (filePath: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setDeleting(true);
      setError(null);

      try {
        const result = await requestFileWrite({
          machineId,
          workingDir,
          filePath,
          operation: 'delete',
        });

        await waitForFileWriteRequest(convex, sessionId, result.requestId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'File delete failed';
        setError(message);
        throw err;
      } finally {
        inFlightRef.current = false;
        setDeleting(false);
      }
    },
    [convex, machineId, requestFileWrite, sessionId, workingDir]
  );

  return { deleteFile, deleting, error };
}
