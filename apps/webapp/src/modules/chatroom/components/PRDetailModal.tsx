'use client';

import { ExternalLink, GitCommit, Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
  FixedModalSidebar,
} from '@/components/ui/fixed-modal';

import { WorkspaceDiffViewer } from '../workspace/components/WorkspaceDiffViewer';
import { PRActionButtons } from '../workspace/components/PRActionButtons';
import { usePRDiff, usePRCommits, useCommitDetail } from '../workspace/hooks/useWorkspaceGit';
import type { PRCommitEntry } from '../workspace/hooks/useWorkspaceGit';
import type { GitPullRequest, FullDiffState } from '../workspace/types/git';

import { prStateBadge } from '../workspace/utils/pr-helpers';

interface PRDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  pr: GitPullRequest;
  machineId: string;
  workingDir: string;
  onPRAction?: (prNumber: number, action: 'merge_squash' | 'merge_no_squash' | 'close') => Promise<void>;
  prActionLoading?: boolean;
}

// ─── Commit List Item ───────────────────────────────────────────────────────

interface CommitListItemProps {
  commit: PRCommitEntry;
  isSelected: boolean;
  onClick: () => void;
}

const CommitListItem = memo(function CommitListItem({ commit, isSelected, onClick }: CommitListItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors border-b border-chatroom-border last:border-b-0',
        'hover:bg-chatroom-bg-hover cursor-pointer',
        isSelected
          ? 'bg-chatroom-bg-hover border-l-2 border-l-chatroom-accent'
          : 'border-l-2 border-l-transparent',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[11px] text-chatroom-accent shrink-0">
          {commit.shortSha}
        </span>
        <span className="text-xs text-chatroom-text-primary truncate">{commit.message}</span>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-chatroom-text-muted">
        {commit.author && <span>{commit.author}</span>}
      </div>
    </button>
  );
});

// ─── PR Detail Modal ────────────────────────────────────────────────────────

/**
 * Modal that displays the diff for a specific PR.
 * Includes a sidebar with the list of commits, loaded on demand.
 * Clicking a commit shows its individual diff; clicking "Full PR Diff" shows the whole PR.
 */
export const PRDetailModal = memo(function PRDetailModal({
  isOpen,
  onClose,
  pr,
  machineId,
  workingDir,
  onPRAction,
  prActionLoading,
}: PRDetailModalProps) {
  const baseBranch = pr.baseRefName ?? 'master';
  const { state: prDiffState, request: requestPRDiff } = usePRDiff(machineId, workingDir, pr.number);
  const { state: prCommitsState, request: requestPRCommits } = usePRCommits(machineId, workingDir, pr.number);
  const { state: commitDetailState, request: requestCommitDetail, clear: clearCommitDetail } = useCommitDetail(machineId, workingDir);

  // Track which view is active: 'pr' for full PR diff, or a SHA for individual commit
  const [activeView, setActiveView] = useState<'pr' | string>('pr');

  // Auto-request diff when modal opens
  useEffect(() => {
    if (isOpen && prDiffState.status === 'idle') {
      requestPRDiff(baseBranch, pr.number);
    }
  }, [isOpen, prDiffState.status, requestPRDiff, baseBranch, pr.number]);

  // Auto-request PR commits when modal opens (on demand = when modal is opened)
  useEffect(() => {
    if (isOpen && prCommitsState.status === 'idle') {
      requestPRCommits();
    }
  }, [isOpen, prCommitsState.status, requestPRCommits]);

  // Reset to full PR view when modal closes
  useEffect(() => {
    if (!isOpen) {
      setActiveView('pr');
      clearCommitDetail();
    }
  }, [isOpen, clearCommitDetail]);

  const handleSelectCommit = useCallback((sha: string) => {
    setActiveView(sha);
    requestCommitDetail(sha);
  }, [requestCommitDetail]);

  const handleSelectFullPR = useCallback(() => {
    setActiveView('pr');
    clearCommitDetail();
  }, [clearCommitDetail]);

  const badge = prStateBadge(pr.state, pr.isDraft, pr.mergedAt);

  // Determine which diff state to show
  const activeDiffState: FullDiffState = activeView === 'pr'
    ? prDiffState
    : (() => {
        if (commitDetailState.status === 'idle' || commitDetailState.status === 'loading') {
          return { status: 'loading' as const };
        }
        if (commitDetailState.status === 'available') {
          return {
            status: 'available' as const,
            content: commitDetailState.content,
            truncated: commitDetailState.truncated,
            diffStat: commitDetailState.diffStat,
          };
        }
        if (commitDetailState.status === 'too_large') {
          return { status: 'error' as const, message: 'Commit diff is too large to display' };
        }
        if (commitDetailState.status === 'not_found') {
          return { status: 'error' as const, message: 'Commit not found' };
        }
        if (commitDetailState.status === 'error') {
          return { status: 'error' as const, message: commitDetailState.message };
        }
        return { status: 'idle' as const };
      })();

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[96vw]">
      {/* Left Sidebar — Commit List */}
      <FixedModalSidebar className="w-72">
        <FixedModalHeader>
          <div className="flex items-center gap-2">
            <GitCommit size={16} className="text-chatroom-accent flex-shrink-0" />
            <FixedModalTitle>Commits</FixedModalTitle>
          </div>
        </FixedModalHeader>
        <FixedModalBody>
          {/* Full PR Diff button */}
          <button
            type="button"
            onClick={handleSelectFullPR}
            className={[
              'w-full text-left px-3 py-2.5 transition-colors border-b-2 border-chatroom-border-strong',
              'hover:bg-chatroom-bg-hover cursor-pointer',
              activeView === 'pr'
                ? 'bg-chatroom-accent/10 border-l-2 border-l-chatroom-accent font-bold'
                : 'border-l-2 border-l-transparent',
            ].join(' ')}
          >
            <span className="text-xs text-chatroom-text-primary">Full PR Diff</span>
          </button>

          {/* Commit list */}
          {prCommitsState.status === 'loading' && (
            <div className="flex items-center justify-center py-8 text-chatroom-text-muted">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}
          {prCommitsState.status === 'available' && prCommitsState.commits.length === 0 && (
            <div className="px-3 py-4 text-xs text-chatroom-text-muted text-center">
              No commits found
            </div>
          )}
          {prCommitsState.status === 'available' && prCommitsState.commits.map((commit) => (
            <CommitListItem
              key={commit.sha}
              commit={commit}
              isSelected={activeView === commit.sha}
              onClick={() => handleSelectCommit(commit.sha)}
            />
          ))}
        </FixedModalBody>
      </FixedModalSidebar>

      {/* Right Content — Diff Viewer */}
      <FixedModalContent>
        <FixedModalHeader onClose={onClose}>
          <div className="flex items-center gap-3 min-w-0">
            <FixedModalTitle>
              <span className="text-chatroom-text-muted">#{pr.number}</span>
            </FixedModalTitle>
            <span className="text-sm text-chatroom-text-primary truncate">{pr.title}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border flex-shrink-0 ${badge.cls}`}>
              {badge.label}
            </span>
            {pr.url && (
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-chatroom-text-muted hover:text-chatroom-accent transition-colors"
                title="Open PR on GitHub"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </FixedModalHeader>
        <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-surface flex items-center gap-3">
          <span className="text-[10px] font-mono text-chatroom-text-muted">
            {pr.headRefName} → {baseBranch}
          </span>
          {activeView !== 'pr' && (
            <span className="text-[10px] font-mono text-chatroom-accent">
              commit: {activeView.slice(0, 7)}
            </span>
          )}
        </div>
        {onPRAction && pr.state === 'OPEN' && (
          <div className="px-4 py-2 border-b border-chatroom-border">
            <PRActionButtons
              onAction={(action) => onPRAction(pr.number, action)}
              loading={prActionLoading}
              onSuccess={onClose}
            />
          </div>
        )}
        <FixedModalBody className="p-0 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <WorkspaceDiffViewer
              state={activeDiffState}
              onRequest={activeView === 'pr' ? () => requestPRDiff(baseBranch, pr.number) : undefined}
            />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
