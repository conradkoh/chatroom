'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

export function useFolderPicker() {
  const requestFolderPicker = useSessionMutation(api.machines.requestFolderPicker);
  const [requestId, setRequestId] = useState<Id<'chatroom_folderPickerRequests'> | null>(null);

  const request = useSessionQuery(
    api.machines.getFolderPickerRequest,
    requestId ? { requestId } : 'skip'
  );

  const pickFolder = useCallback(
    async (machineId: string) => {
      const result = await requestFolderPicker({ machineId });
      setRequestId(result.requestId);
      return result.requestId;
    },
    [requestFolderPicker]
  );

  const reset = useCallback(() => {
    setRequestId(null);
  }, []);

  return {
    pickFolder,
    request,
    requestId,
    reset,
    isPending: requestId != null && request?.status === 'pending',
  };
}
