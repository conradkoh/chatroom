'use client';

import { memo } from 'react';
import { AlertCircle, AlertTriangle, GitBranch } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkspaceGitState, DiffStat } from '../types/git';

interface WorkspaceGitBranchProps {
  state: WorkspaceGitState;
}

/** Renders a compact one-line diff stat summary, e.g. "7 files · +156 −43". */
const DiffStatSummary = memo(function DiffStatSummary({ diffStat }: { diffStat: DiffStat }) {
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

/**
 * Displays the git branch and diff stat for a workspace.
 *
 * Renders all four WorkspaceGitState variants:
 *   loading | not_found | error | available
 */
export const WorkspaceGitBranch = memo(function WorkspaceGitBranch({
  state,
}: WorkspaceGitBranchProps) {
  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-1.5 py-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-text-muted">
        <AlertCircle size={13} className="shrink-0" />
        <span className="text-[11px]">Git info not found</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-status-error">
        <AlertTriangle size={13} className="shrink-0" />
        <span className="text-[11px] truncate">{state.message}</span>
      </div>
    );
  }

  // state.status === 'available'
  const { branch, isDirty, diffStat } = state;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Branch icon + name */}
      <GitBranch size={14} className="text-chatroom-text-muted shrink-0" />
      <span className="font-mono text-xs text-chatroom-text-primary truncate">{branch}</span>

      {/* Dirty indicator */}
      {isDirty && (
        <span
          className="inline-block shrink-0 rounded-full bg-chatroom-status-warning"
          style={{ width: 6, height: 6 }}
          title="Uncommitted changes"
        />
      )}

      {/* Diff stat summary */}
      <DiffStatSummary diffStat={diffStat} />
    </div>
  );
});
