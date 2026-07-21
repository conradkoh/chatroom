'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import { MAX_WORKSPACE_UPLOAD_BYTES } from '@workspace/backend/src/domain/constants/workspace-upload';
import { useConvex } from 'convex/react';
import { useSessionId, useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useRef, useState } from 'react';

import { waitForFileWriteRequest } from './fileWritePolling';

const UPLOAD_WRITE_TIMEOUT_MS = 5 * 60 * 1000;

interface UseWorkspaceFileUploadArgs {
  machineId: string;
  workingDir: string;
}

function formatMaxUploadSize(): string {
  return `${Math.round(MAX_WORKSPACE_UPLOAD_BYTES / (1024 * 1024))} MB`;
}

export function useWorkspaceFileUpload({ machineId, workingDir }: UseWorkspaceFileUploadArgs) {
  const convex = useConvex();
  const [sessionId] = useSessionId();
  const generateUploadUrl = useSessionMutation(api.workspaceFiles.generateWorkspaceFileUploadUrl);
  const requestFileWrite = useSessionMutation(api.workspaceFiles.requestFileWrite);
  const inFlightRef = useRef(false);
  const [uploading, setUploading] = useState(false);

  // fallow-ignore-next-line complexity
  const uploadFile = useCallback(
    async (filePath: string, file: File) => {
      if (inFlightRef.current) return;
      if (file.size > MAX_WORKSPACE_UPLOAD_BYTES) {
        throw new Error(`File is too large (max ${formatMaxUploadSize()})`);
      }

      inFlightRef.current = true;
      setUploading(true);

      try {
        const { uploadUrl } = await generateUploadUrl({ machineId, workingDir });
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload file');
        }

        const { storageId } = (await uploadResponse.json()) as { storageId: string };
        const result = await requestFileWrite({
          machineId,
          workingDir,
          filePath,
          operation: 'create',
          storageId: storageId as never,
        });

        await waitForFileWriteRequest(convex, sessionId, result.requestId, {
          timeoutMs: UPLOAD_WRITE_TIMEOUT_MS,
        });
      } finally {
        inFlightRef.current = false;
        setUploading(false);
      }
    },
    [convex, generateUploadUrl, machineId, requestFileWrite, sessionId, workingDir]
  );

  return { uploadFile, uploading };
}
