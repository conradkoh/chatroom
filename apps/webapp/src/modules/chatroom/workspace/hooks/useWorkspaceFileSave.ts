'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';
import { compressGzip } from '../utils/gzipContent';

export type FileWriteOperation = 'create' | 'update' | 'delete';

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

      await waitForFileWriteRequest(convex, sessionId, result.requestId);

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
