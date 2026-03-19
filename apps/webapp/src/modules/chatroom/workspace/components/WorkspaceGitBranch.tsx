'use client';

import { AlertCircle, AlertTriangle, GitBranch } from 'lucide-react';
import { memo } from 'react';

import { InlineDiffStat, formatRelativeTime } from './shared';
import type { WorkspaceGitState } from '../types/git';

import { Skeleton } from '@/components/ui/skeleton';

interface WorkspaceGitBranchProps {
  state: WorkspaceGitState;
}

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
        <span className="text-xs">Git info not found</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-chatroom-status-error">
        <AlertTriangle size={13} className="shrink-0" />
        <span className="text-xs truncate">{state.message}</span>
      </div>
    );
  }

  // state.status === 'available'
  const { branch, isDirty, diffStat } = state;
  const displayBranch = branch === 'HEAD' ? 'detached HEAD' : branch;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Branch icon + name */}
      <GitBranch size={14} className="text-chatroom-text-muted shrink-0" />
      <span className="font-mono text-xs text-chatroom-text-primary truncate">{displayBranch}</span>

      {/* Dirty indicator */}
      {isDirty && (
        <span
          className="inline-block shrink-0 rounded-full bg-chatroom-status-warning"
          style={{ width: 6, height: 6 }}
          title="Uncommitted changes"
        />
      )}

      {/* Diff stat summary */}
      <InlineDiffStat diffStat={diffStat} />

      {/* Last updated */}
      {state.updatedAt && (
        <span
          className="text-[10px] text-chatroom-text-muted shrink-0"
          title={new Date(state.updatedAt).toLocaleString()}
        >
          {formatRelativeTime(state.updatedAt)}
        </span>
      )}
    </div>
  );
});
