'use client';

import { memo, useEffect } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommitDetailState, FullDiffState, DiffStat } from '../types/git';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceCommitDetailProps {
  sha: string;
  state: CommitDetailState;
  onRequestDetail: (sha: string) => void;
  onClose: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Compact diff stat line: "3 files · +28 −0" */
const InlineDiffStat = memo(function InlineDiffStat({ diffStat }: { diffStat: DiffStat }) {
  const { filesChanged, insertions, deletions } = diffStat;
  const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;

  if (isClean) {
    return <span className="text-[11px] text-chatroom-text-muted">Clean</span>;
  }

  return (
    <span className="text-[11px] text-chatroom-text-muted flex items-center gap-1">
      <span>{filesChanged} {filesChanged === 1 ? 'file' : 'files'}</span>
      <span>·</span>
      <span className="text-chatroom-status-success">+{insertions}</span>
      <span className="text-chatroom-status-error">−{deletions}</span>
    </span>
  );
});

/** Header row shown in all states. */
const DetailHeader = memo(function DetailHeader({
  sha,
  onClose,
}: {
  sha: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b border-chatroom-border">
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="p-0 h-auto text-chatroom-text-muted hover:text-chatroom-text-primary"
        title="Back to log"
      >
        <ArrowLeft size={14} />
      </Button>
      <span className="font-mono text-[11px] text-chatroom-text-secondary truncate">{sha.slice(0, 12)}</span>
    </div>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Displays the detail view for a single git commit.
 *
 * Requests detail data on mount / when sha changes (if state is idle).
 * Reuses WorkspaceDiffViewer for the diff content.
 */
export const WorkspaceCommitDetail = memo(function WorkspaceCommitDetail({
  sha,
  state,
  onRequestDetail,
  onClose,
}: WorkspaceCommitDetailProps) {
  // Auto-request detail when sha changes and state is idle.
  useEffect(() => {
    if (state.status === 'idle') {
      onRequestDetail(sha);
    }
  }, [sha, state.status, onRequestDetail]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <DetailHeader sha={sha} onClose={onClose} />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <DetailHeader sha={sha} onClose={onClose} />
        <div className="flex items-center gap-1.5 text-chatroom-status-error text-[11px]">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{state.message}</span>
        </div>
      </div>
    );
  }

  // state.status === 'available'
  const fullDiffState: FullDiffState = {
    status: 'available',
    content: state.content,
    truncated: state.truncated,
    diffStat: state.diffStat,
  };

  return (
    <div className="flex flex-col gap-3">
      <DetailHeader sha={sha} onClose={onClose} />

      {/* Commit metadata */}
      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-chatroom-text-primary font-medium leading-snug">
          {state.message}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-chatroom-text-muted flex-wrap">
          <span>{state.author}</span>
          <span>·</span>
          <span>{new Date(state.date).toLocaleDateString()}</span>
          <span>·</span>
          <InlineDiffStat diffStat={state.diffStat} />
        </div>
      </div>

      {/* Diff viewer */}
      <WorkspaceDiffViewer state={fullDiffState} onRequest={() => {}} />
    </div>
  );
});
