'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';

interface UseWorkspaceFileMkdirArgs {
  machineId: string;
  workingDir: string;
}

type MkdirRequestResult = {
  requestId: Id<'chatroom_workspaceFileWriteRequests'>;
};

export function useWorkspaceFileMkdir({ machineId, workingDir }: UseWorkspaceFileMkdirArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);

  const requestMkdir = useCallback(
    async (dirPath: string): Promise<MkdirRequestResult> => {
      const result = await requestFileWrite({
        machineId,
        workingDir,
        filePath: dirPath,
        operation: 'mkdir',
      });
      return { requestId: result.requestId };
    },
    [machineId, requestFileWrite, workingDir]
  );

  const confirmMkdir = useCallback(
    async (requestId: Id<'chatroom_workspaceFileWriteRequests'>) => {
      await waitForFileWriteRequest(convex, sessionId, requestId);
    },
    [convex, sessionId]
  );

  return { requestMkdir, confirmMkdir };
}
