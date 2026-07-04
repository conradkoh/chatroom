'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';

interface UseWorkspaceFileDeleteArgs {
  machineId: string;
  workingDir: string;
}

type DeleteRequestResult = {
  requestId: Id<'chatroom_workspaceFileWriteRequests'>;
};

export function useWorkspaceFileDelete({ machineId, workingDir }: UseWorkspaceFileDeleteArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);

  /** Submit delete to backend (returns when pending request is created). */
  const requestDelete = useCallback(
    async (filePath: string): Promise<DeleteRequestResult> => {
      const result = await requestFileWrite({
        machineId,
        workingDir,
        filePath,
        operation: 'delete',
      });
      return { requestId: result.requestId };
    },
    [machineId, requestFileWrite, workingDir]
  );

  /** Poll until daemon confirms or terminal error. */
  const confirmDelete = useCallback(
    async (requestId: Id<'chatroom_workspaceFileWriteRequests'>) => {
      await waitForFileWriteRequest(convex, sessionId, requestId);
    },
    [convex, sessionId]
  );

  return { requestDelete, confirmDelete };
}
