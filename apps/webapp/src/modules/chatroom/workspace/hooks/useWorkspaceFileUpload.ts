'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import { MAX_WORKSPACE_UPLOAD_BYTES } from '@workspace/backend/src/domain/constants/workspace-upload';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

import { FILE_WRITE_CONFIRM_TIMEOUT_MS, waitForFileWriteRequest } from './fileWritePolling';
import { uploadFileToConvexStorage } from '../utils/uploadFileToConvexStorage';
import { percentForUploadBytes } from '../utils/workspaceUploadProgress';

export type WorkspaceFileUploadProgressUpdate = {
  phase: 'uploading' | 'finalizing' | 'complete';
  percent: number;
};

interface UseWorkspaceFileUploadArgs {
  machineId: string | null;
  workingDir: string | null;
}

function formatMaxUploadSize(): string {
  return `${Math.round(MAX_WORKSPACE_UPLOAD_BYTES / (1024 * 1024))} MB`;
}

export function useWorkspaceFileUpload({ machineId, workingDir }: UseWorkspaceFileUploadArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const generateUploadUrl = useSessionMutation(api.workspaceFiles.generateWorkspaceFileUploadUrl);
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);
  const discardUnattachedUpload = useSessionMutation(
    api.workspaceFiles.discardUnattachedWorkspaceUpload
  );

  const uploadFile = useCallback(
    async (
      filePath: string,
      file: File,
      onProgress?: (update: WorkspaceFileUploadProgressUpdate) => void,
      options?: { uploadKind?: 'chatAttachment' }
    ) => {
      if (!machineId || !workingDir) {
        throw new Error('No workspace connected');
      }
      if (file.size > MAX_WORKSPACE_UPLOAD_BYTES) {
        throw new Error(`File is too large (max ${formatMaxUploadSize()})`);
      }

      onProgress?.({ phase: 'uploading', percent: 0 });
      const { uploadUrl } = await generateUploadUrl({ machineId, workingDir });
      const { storageId } = await uploadFileToConvexStorage(uploadUrl, file, (loaded, total) => {
        onProgress?.({ phase: 'uploading', percent: percentForUploadBytes(loaded, total) });
      });

      onProgress?.({ phase: 'finalizing', percent: 90 });
      try {
        const result = await requestFileWrite({
          machineId,
          workingDir,
          filePath,
          operation: 'create',
          storageId: storageId as never,
          ...(options?.uploadKind ? { uploadKind: options.uploadKind } : {}),
        });

        await waitForFileWriteRequest(convex, sessionId, result.requestId, {
          timeoutMs: FILE_WRITE_CONFIRM_TIMEOUT_MS,
        });
      } catch (error) {
        await discardUnattachedUpload({
          machineId,
          workingDir,
          storageId: storageId as never,
        }).catch(() => undefined);
        throw error;
      }

      onProgress?.({ phase: 'complete', percent: 100 });
    },
    [
      convex,
      discardUnattachedUpload,
      generateUploadUrl,
      machineId,
      requestFileWrite,
      sessionId,
      workingDir,
    ]
  );

  return { uploadFile };
}
