'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useState } from 'react';

/** Matches daemon event TTL for folder picker delivery. */
const FOLDER_PICKER_TIMEOUT_MS = 5 * 60_000;

// fallow-ignore-next-line complexity
export function useFolderPicker() {
  const requestFolderPicker = useSessionMutation(api.machines.requestFolderPicker);
  const [requestId, setRequestId] = useState<Id<'chatroom_folderPickerRequests'> | null>(null);
  const [isTimedOut, setIsTimedOut] = useState(false);

  const request = useSessionQuery(
    api.machines.getFolderPickerRequest,
    requestId ? { requestId } : 'skip'
  );

  useEffect(() => {
    if (!requestId || !request || request.status !== 'pending') {
      setIsTimedOut(false);
      return;
    }

    const elapsed = Date.now() - request.createdAt;
    const remaining = FOLDER_PICKER_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      setIsTimedOut(true);
      return;
    }

    const timer = setTimeout(() => setIsTimedOut(true), remaining);
    return () => clearTimeout(timer);
  }, [requestId, request]);

  const pickFolder = useCallback(
    async (machineId: string) => {
      setIsTimedOut(false);
      const result = await requestFolderPicker({ machineId });
      setRequestId(result.requestId);
      return result.requestId;
    },
    [requestFolderPicker]
  );

  const reset = useCallback(() => {
    setRequestId(null);
    setIsTimedOut(false);
  }, []);

  const isPending = Boolean(requestId && (!request || request.status === 'pending') && !isTimedOut);

  return {
    pickFolder,
    request,
    requestId,
    reset,
    isPending,
    isTimedOut,
  };
}
