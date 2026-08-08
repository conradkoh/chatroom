'use client';
// fallow-ignore-file complexity

import { useCallback, useEffect, useRef, useState } from 'react';

import { useWorkspaceFileUpload } from './useWorkspaceFileUpload';
import { basename } from '../utils/diff-parser';
import {
  COMPLETE_PROGRESS,
  FINALIZING_PROGRESS,
  UPLOAD_COMPLETE_DISMISS_MS,
  UPLOAD_ERROR_DISMISS_MS,
  type WorkspaceUploadJob,
} from '../utils/workspaceUploadProgress';

export type UseWorkspaceUploadJobsArgs = {
  machineId: string | null;
  workingDir: string | null;
  onUploadComplete?: (filePath: string) => void;
  onUploadFailed?: (filePath: string, error: string) => void;
};

export function useWorkspaceUploadJobs({
  machineId,
  workingDir,
  onUploadComplete,
  onUploadFailed,
}: UseWorkspaceUploadJobsArgs) {
  const [jobs, setJobs] = useState<WorkspaceUploadJob[]>([]);
  const { uploadFile } = useWorkspaceFileUpload({ machineId, workingDir });
  const dismissTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeJob = useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id));
    const timer = dismissTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const scheduleDismiss = useCallback(
    (id: string, delayMs: number) => {
      const existing = dismissTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => removeJob(id), delayMs);
      dismissTimersRef.current.set(id, timer);
    },
    [removeJob]
  );

  useEffect(() => {
    const dismissTimers = dismissTimersRef.current;
    return () => {
      for (const timer of dismissTimers.values()) {
        clearTimeout(timer);
      }
      dismissTimers.clear();
    };
  }, []);

  const startUpload = useCallback(
    async (filePath: string, file: File) => {
      const id = crypto.randomUUID();
      setJobs((current) => [
        ...current,
        { id, filePath, fileName: basename(filePath), phase: 'uploading', percent: 0 },
      ]);

      try {
        await uploadFile(filePath, file, (update) => {
          setJobs((current) =>
            current.map((job) =>
              job.id === id ? { ...job, phase: update.phase, percent: update.percent } : job
            )
          );
        });
        setJobs((current) =>
          current.map((job) =>
            job.id === id ? { ...job, phase: 'complete', percent: COMPLETE_PROGRESS } : job
          )
        );
        scheduleDismiss(id, UPLOAD_COMPLETE_DISMISS_MS);
        onUploadComplete?.(filePath);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to upload file';
        setJobs((current) =>
          current.map((job) =>
            job.id === id
              ? { ...job, phase: 'error', percent: FINALIZING_PROGRESS, errorMessage: message }
              : job
          )
        );
        scheduleDismiss(id, UPLOAD_ERROR_DISMISS_MS);
        onUploadFailed?.(filePath, message);
      }
    },
    [onUploadComplete, onUploadFailed, scheduleDismiss, uploadFile]
  );

  return { jobs, startUpload };
}
