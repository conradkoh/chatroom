'use client';
// fallow-ignore-file complexity

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { CheckCircle2, X, XCircle } from 'lucide-react';

import { phaseLabel, type WorkspaceUploadJob } from '../utils/workspaceUploadProgress';

import { ProgressIndicator, ProgressLabel, ProgressTrack } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

function ProgressRow({
  job,
  onDismiss,
}: {
  job: WorkspaceUploadJob;
  onDismiss?: (id: string) => void;
}) {
  const isComplete = job.phase === 'complete';
  const isError = job.phase === 'error';

  return (
    <div className="space-y-0.5" data-testid={`upload-job-${job.id}`}>
      <ProgressPrimitive.Root value={job.percent} className="flex flex-wrap items-center gap-1">
        <ProgressLabel className="min-w-0 flex-1 truncate text-xs text-chatroom-text-primary">
          <span title={job.filePath}>{job.fileName}</span>
        </ProgressLabel>
        <span className="shrink-0 text-[10px] text-chatroom-text-muted tabular-nums">
          {isComplete ? (
            <span className="inline-flex items-center gap-1 text-chatroom-status-success">
              <CheckCircle2 size={12} />
              {job.percent}%
            </span>
          ) : isError ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <XCircle size={12} />
              {job.percent}%
            </span>
          ) : (
            `${job.percent}%`
          )}
        </span>
        <p className="w-full text-[10px] text-chatroom-text-muted">{phaseLabel(job.phase)}</p>
        <ProgressTrack className="w-full">
          <ProgressIndicator
            className={cn(
              'transition-all',
              isComplete && 'bg-chatroom-status-success',
              isError && 'bg-destructive'
            )}
          />
        </ProgressTrack>
      </ProgressPrimitive.Root>
      {isError ? (
        <div className="flex items-start gap-1">
          {job.errorMessage ? (
            <p className="min-w-0 flex-1 break-words text-[10px] text-chatroom-status-error">
              {job.errorMessage}
            </p>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(job.id)}
              aria-label="Dismiss"
              className="-m-1 shrink-0 p-1 text-chatroom-status-error opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current"
            >
              <X size={12} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceUploadProgressList({
  jobs,
  embedded = false,
  onDismiss,
}: {
  jobs: WorkspaceUploadJob[];
  embedded?: boolean;
  onDismiss?: (id: string) => void;
}) {
  if (jobs.length === 0) return null;

  return (
    <div
      className={cn(
        'shrink-0 space-y-2 px-3 py-2',
        !embedded && 'border-t-2 border-chatroom-border-strong'
      )}
    >
      {jobs.map((job) => (
        <ProgressRow key={job.id} job={job} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
