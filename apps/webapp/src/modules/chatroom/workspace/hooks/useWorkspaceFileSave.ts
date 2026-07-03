'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import { compressGzip } from '../utils/gzipContent';

const FILE_WRITE_POLL_INTERVAL_MS = 500;
const FILE_WRITE_POLL_TIMEOUT_MS = 30_000;

export type FileWriteOperation = 'create' | 'update';

export type FileWriteRequestStatus = {
  status: 'pending' | 'done' | 'error';
  errorMessage?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a write request until it completes or times out. */
// fallow-ignore-next-line complexity
export async function pollFileWriteRequest(
  queryFn: (
    requestId: Id<'chatroom_workspaceFileWriteRequests'>
  ) => Promise<FileWriteRequestStatus | null>,
  requestId: Id<'chatroom_workspaceFileWriteRequests'>
): Promise<void> {
  const deadline = Date.now() + FILE_WRITE_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await queryFn(requestId);
    if (result?.status === 'done') return;
    if (result?.status === 'error') {
      throw new Error(result.errorMessage ?? 'File write failed');
    }
    await sleep(FILE_WRITE_POLL_INTERVAL_MS);
  }

  throw new Error('File write timed out');
}

interface UseWorkspaceFileSaveArgs {
  machineId: string;
  workingDir: string;
  filePath: string;
  getContent: () => string;
  operation: FileWriteOperation;
}

export function useWorkspaceFileSave({
  machineId,
  workingDir,
  filePath,
  getContent,
  operation,
}: UseWorkspaceFileSaveArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);
  const saveInFlightRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const save = useCallback(async () => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setError(null);

    try {
      const data = await compressGzip(getContent());
      const result = await requestFileWrite({
        machineId,
        workingDir,
        filePath,
        operation,
        data,
      });

      await pollFileWriteRequest(async (requestId) => {
        if (!sessionId) {
          throw new Error('Authentication required');
        }
        return convex.query(api.workspaceFiles.getFileWriteRequest, {
          sessionId,
          requestId,
        });
      }, result.requestId);

      setLastSavedAt(Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'File write failed';
      setError(message);
      throw err;
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }, [convex, filePath, getContent, machineId, operation, requestFileWrite, sessionId, workingDir]);

  return { save, saving, error, lastSavedAt };
}
