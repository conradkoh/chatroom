'use client';

import { ExternalLink } from 'lucide-react';
import { memo, useEffect, useCallback } from 'react';

import { PRActionButtons } from './PRActionButtons';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';
import { usePRDiff } from '../hooks/useWorkspaceGit';

import type { GitPullRequest } from '../types/git';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspacePRReviewProps {
  activePR: GitPullRequest;
  machineId: string;
  workingDir: string;
  baseBranch: string;
  onPRAction: (action: 'merge_squash' | 'merge_no_squash' | 'close') => Promise<void>;
  prActionLoading: boolean;
}

// ─── Component ─────────────────────────────────────────────────────────────────

/**
 * Workspace PR Review Component
 *
 * Renders the PR review tab content, including:
 * - PR header and metadata
 * - Action buttons (merge, close)
 * - Diff viewer
 *
 * This is extracted into a separate component to ensure the usePRDiff hook
 * is called unconditionally (React Hooks Rules).
 * The hook receives activePR.prNumber (always defined) so the PR number is required.
 */
export const WorkspacePRReview = memo(function WorkspacePRReview({
  activePR,
  machineId,
  workingDir,
  baseBranch,
  onPRAction,
  prActionLoading,
}: WorkspacePRReviewProps) {
  const prNumber = activePR.prNumber!;
  const { state: prDiffState, request: requestPRDiff } = usePRDiff(
    machineId,
    workingDir,
    prNumber
  );

  // Auto-request PR diff when component mounts or PR number changes
  useEffect(() => {
    if (prDiffState.status === 'idle') {
      requestPRDiff(baseBranch, prNumber);
    }
  }, [prDiffState.status, requestPRDiff, baseBranch, prNumber]);

  const handlePRAction = useCallback(
    async (action: 'merge_squash' | 'merge_no_squash' | 'close') => {
      await onPRAction(action);
    },
    [onPRAction]
  );

  return (
    <div className="flex flex-col h-full">
      {/* PR header */}
      <div className="px-4 py-3 border-b border-chatroom-border bg-chatroom-bg-surface">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-chatroom-text-primary">#{activePR.prNumber}</span>
          <span className="text-xs text-chatroom-text-secondary truncate">{activePR.title}</span>
          <a
            href={activePR.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex-shrink-0 text-chatroom-text-muted hover:text-chatroom-accent transition-colors"
            title="Open PR on GitHub"
          >
            <ExternalLink size={12} />
          </a>
        </div>
        <div className="text-[10px] text-chatroom-text-muted mt-1">
          {activePR.headRefName} → {baseBranch}
        </div>
      </div>

      {/* PR action buttons */}
      <div className="px-4 py-2 border-b border-chatroom-border">
        <PRActionButtons onAction={handlePRAction} loading={prActionLoading} />
      </div>

      {/* PR diff content */}
      <div className="flex-1 overflow-y-auto">
        <WorkspaceDiffViewer
          state={prDiffState}
          onRequest={() => requestPRDiff(baseBranch, prNumber)}
          machineId={machineId}
          workingDir={workingDir}
        />
      </div>
    </div>
  );
});
