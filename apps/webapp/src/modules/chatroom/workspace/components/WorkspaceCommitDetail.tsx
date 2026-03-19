'use client';

import { AlertTriangle, AlertCircle } from 'lucide-react';
import { memo, useEffect } from 'react';

import { InlineDiffStat } from './shared';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';
import type { CommitDetailState, FullDiffState } from '../types/git';

import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceCommitDetailProps {
  sha: string;
  state: CommitDetailState;
  onRequestDetail: (sha: string) => void;
  onClose?: () => void;
}

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

  if (state.status === 'too_large') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-text-muted text-[11px] p-4">
        <AlertCircle size={13} className="shrink-0" />
        <span>Commit diff is too large to display</span>
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-text-muted text-[11px] p-4">
        <AlertCircle size={13} className="shrink-0" />
        <span>Commit not found</span>
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
