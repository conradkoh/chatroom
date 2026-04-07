'use client';

import { ExternalLink } from 'lucide-react';
import { memo, useEffect } from 'react';

import {
  FixedModal,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
  FixedModalBody,
} from '@/components/ui/fixed-modal';

import { WorkspaceDiffViewer } from '../workspace/components/WorkspaceDiffViewer';
import { usePRDiff } from '../workspace/hooks/useWorkspaceGit';
import type { GitPullRequest } from '../workspace/types/git';

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

/**
 * Modal that displays the diff for a specific PR.
 * Fetches the diff via the daemon's PR diff infrastructure.
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
  const { state: prDiffState, request: requestPRDiff } = usePRDiff(machineId, workingDir);

  // Auto-request diff when modal opens
  useEffect(() => {
    if (isOpen && prDiffState.status === 'idle') {
      requestPRDiff(baseBranch, pr.number);
    }
  }, [isOpen, prDiffState.status, requestPRDiff, baseBranch, pr.number]);

  const badge = prStateBadge(pr.state, pr.isDraft, pr.mergedAt);

  return (
    <FixedModal isOpen={isOpen} onClose={onClose} maxWidth="max-w-[96vw]">
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
        <div className="px-4 py-2 border-b border-chatroom-border bg-chatroom-bg-surface">
          <span className="text-[10px] font-mono text-chatroom-text-muted">
            {pr.headRefName} → {baseBranch}
          </span>
        </div>
        {onPRAction && pr.state === 'OPEN' && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-chatroom-border">
            <button
              type="button"
              onClick={() => onPRAction(pr.number, 'merge_squash')}
              disabled={prActionLoading}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-accent text-chatroom-bg-primary border border-chatroom-accent transition-all duration-100 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {prActionLoading ? '...' : 'Merge (Squash)'}
            </button>
            <button
              type="button"
              onClick={() => onPRAction(pr.number, 'merge_no_squash')}
              disabled={prActionLoading}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-chatroom-text-secondary border border-chatroom-border transition-all duration-100 hover:border-chatroom-accent hover:text-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Merge
            </button>
            <button
              type="button"
              onClick={() => onPRAction(pr.number, 'close')}
              disabled={prActionLoading}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-red-500 dark:text-red-400 border border-red-300 dark:border-red-800 transition-all duration-100 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Close
            </button>
          </div>
        )}
        <FixedModalBody className="p-0 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <WorkspaceDiffViewer
              state={prDiffState}
              onRequest={() => requestPRDiff(baseBranch, pr.number)}
            />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
