'use client';

import { memo, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { CommitDetailState, FullDiffState, DiffStat } from '../types/git';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceCommitDetailProps {
  sha: string;
  state: CommitDetailState;
  onRequestDetail: (sha: string) => void;
  /** @deprecated No longer rendered — kept for backward compat. */
  onClose?: () => void;
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
      <span>
        {filesChanged} {filesChanged === 1 ? 'file' : 'files'}
      </span>
      <span>·</span>
      <span className="text-chatroom-status-success">+{insertions}</span>
      <span className="text-chatroom-status-error">−{deletions}</span>
    </span>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Displays the detail view for a single git commit.
 *
 * Shows a compact commit info header and a full-height WorkspaceDiffViewer
 * (which includes its own file list sidebar). Intended to be rendered in the
 * right portion of a multi-column layout alongside the commit list.
 */
export const WorkspaceCommitDetail = memo(function WorkspaceCommitDetail({
  sha,
  state,
  onRequestDetail,
}: WorkspaceCommitDetailProps) {
  // Auto-request detail when sha changes and state is idle.
  useEffect(() => {
    if (state.status === 'idle') {
      onRequestDetail(sha);
    }
  }, [sha, state.status, onRequestDetail]);

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div className="flex flex-col gap-1.5 p-4">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-status-error text-[11px] p-4">
        <AlertTriangle size={13} className="shrink-0" />
        <span>{state.message}</span>
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
    <div className="h-full flex flex-col">
      {/* Compact commit info header */}
      <div className="px-4 py-2 border-b border-chatroom-border shrink-0 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[11px] text-chatroom-accent shrink-0">
          {sha.slice(0, 12)}
        </span>
        <span className="text-xs text-chatroom-text-primary font-medium leading-snug truncate min-w-0">
          {state.message}
        </span>
        <span className="text-[11px] text-chatroom-text-muted shrink-0">{state.author}</span>
        <span className="text-[11px] text-chatroom-text-muted shrink-0">·</span>
        <span className="text-[11px] text-chatroom-text-muted shrink-0">
          {new Date(state.date).toLocaleDateString()}
        </span>
        <span className="text-[11px] text-chatroom-text-muted shrink-0">·</span>
        <InlineDiffStat diffStat={state.diffStat} />
      </div>

      {/* Diff viewer — fills remaining height */}
      <div className="flex-1 min-h-0">
        <WorkspaceDiffViewer state={fullDiffState} />
      </div>
    </div>
  );
});
