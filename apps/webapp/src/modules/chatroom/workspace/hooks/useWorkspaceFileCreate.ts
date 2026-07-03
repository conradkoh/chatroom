'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';
import { compressGzip } from '../utils/gzipContent';

interface UseWorkspaceFileCreateArgs {
  machineId: string;
  workingDir: string;
}

export function useWorkspaceFileCreate({ machineId, workingDir }: UseWorkspaceFileCreateArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);
  const inFlightRef = useRef(false);
  const [creating, setCreating] = useState(false);

  /** Fire-and-forget create; resolves when backend/daemon confirms or throws on error. */
  const createFile = useCallback(
    async (filePath: string, content = '') => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setCreating(true);

      try {
        const data = await compressGzip(content);
        const result = await requestFileWrite({
          machineId,
          workingDir,
          filePath,
          operation: 'create',
          data,
        });
        await waitForFileWriteRequest(convex, sessionId, result.requestId);
      } finally {
        inFlightRef.current = false;
        setCreating(false);
      }
    },
    [convex, machineId, requestFileWrite, sessionId, workingDir]
  );

  return { createFile, creating };
}
