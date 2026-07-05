'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';

interface UseWorkspaceFileRenameArgs {
  machineId: string;
  workingDir: string;
}

type RenameRequestResult = {
  requestId: Id<'chatroom_workspaceFileWriteRequests'>;
};

export function useWorkspaceFileRename({ machineId, workingDir }: UseWorkspaceFileRenameArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);

  const requestRename = useCallback(
    async (filePath: string, targetFilePath: string): Promise<RenameRequestResult> => {
      const result = await requestFileWrite({
        machineId,
        workingDir,
        filePath,
        targetFilePath,
        operation: 'rename',
      });
      return { requestId: result.requestId };
    },
    [machineId, requestFileWrite, workingDir]
  );

  const confirmRename = useCallback(
    async (requestId: Id<'chatroom_workspaceFileWriteRequests'>) => {
      await waitForFileWriteRequest(convex, sessionId, requestId);
    },
    [convex, sessionId]
  );

  return { requestRename, confirmRename };
}
