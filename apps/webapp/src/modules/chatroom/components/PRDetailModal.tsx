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

function prStateBadge(state: string, isDraft?: boolean, mergedAt?: string | null) {
  if (isDraft) return { label: 'Draft', cls: 'text-chatroom-text-muted border-chatroom-border' };
  if (state === 'MERGED' || mergedAt) return { label: 'Merged', cls: 'text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700' };
  if (state === 'CLOSED') return { label: 'Closed', cls: 'text-red-500 dark:text-red-400 border-red-300 dark:border-red-700' };
  return { label: 'Open', cls: 'text-green-600 dark:text-green-400 border-green-300 dark:border-green-700' };
}

interface PRDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  pr: GitPullRequest;
  machineId: string;
  workingDir: string;
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
}: PRDetailModalProps) {
  const baseBranch = pr.baseRefName ?? 'master';
  const { state: prDiffState, request: requestPRDiff } = usePRDiff(machineId, workingDir);

  // Auto-request diff when modal opens
  useEffect(() => {
    if (isOpen && prDiffState.status === 'idle') {
      requestPRDiff(baseBranch);
    }
  }, [isOpen, prDiffState.status, requestPRDiff, baseBranch]);

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
        <FixedModalBody className="p-0 overflow-hidden">
          <div className="h-full overflow-y-auto">
            <WorkspaceDiffViewer
              state={prDiffState}
              onRequest={() => requestPRDiff(baseBranch)}
            />
          </div>
        </FixedModalBody>
      </FixedModalContent>
    </FixedModal>
  );
});
