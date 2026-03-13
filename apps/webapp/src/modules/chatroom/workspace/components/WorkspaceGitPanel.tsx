'use client';

import { memo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useWorkspaceGit,
  useFullDiff,
  useCommitDetail,
  useLoadMoreCommits,
} from '../hooks/useWorkspaceGit';
import { WorkspaceGitBranch } from './WorkspaceGitBranch';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';
import { WorkspaceGitLog } from './WorkspaceGitLog';
import { WorkspaceCommitDetail } from './WorkspaceCommitDetail';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceGitPanelProps {
  machineId: string;
  workingDir: string;
}

type ActiveTab = 'branch' | 'diff' | 'log';

// ─── Tab bar ──────────────────────────────────────────────────────────────────

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'branch', label: 'Branch' },
  { id: 'diff', label: 'Diff' },
  { id: 'log', label: 'History' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Container panel for workspace git info.
 *
 * Fetches git state and wires child components together with
 * tab switching and commit selection state.
 */
export const WorkspaceGitPanel = memo(function WorkspaceGitPanel({
  machineId,
  workingDir,
}: WorkspaceGitPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('branch');
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);

  const gitState = useWorkspaceGit(machineId, workingDir);
  const { state: fullDiffState, request: requestDiff } = useFullDiff(machineId, workingDir);
  const {
    state: commitDetailState,
    request: requestCommitDetail,
    clear: clearCommitDetail,
  } = useCommitDetail(machineId, workingDir);
  const { loading: loadingMore, loadMore } = useLoadMoreCommits(machineId, workingDir);

  const handleSelectCommit = useCallback(
    (sha: string) => {
      clearCommitDetail(); // reset so it loads fresh
      setSelectedCommitSha(sha);
    },
    [clearCommitDetail],
  );

  const handleCloseCommitDetail = useCallback(() => {
    setSelectedCommitSha(null);
    clearCommitDetail();
  }, [clearCommitDetail]);

  // For non-available states, render without tabs
  if (gitState.status !== 'available') {
    return <WorkspaceGitBranch state={gitState} />;
  }

  return (
    <div className="flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-3 border-b border-chatroom-border mb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id);
              // Reset commit selection when leaving log tab
              if (tab.id !== 'log') {
                setSelectedCommitSha(null);
                clearCommitDetail();
              }
            }}
            className={cn(
              'text-[10px] font-bold uppercase tracking-widest pb-1.5 transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'text-chatroom-text-primary border-chatroom-accent'
                : 'text-chatroom-text-muted hover:text-chatroom-text-secondary border-transparent',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content pane */}
      <div className="pt-3">
        {activeTab === 'branch' && <WorkspaceGitBranch state={gitState} />}

        {activeTab === 'diff' && (
          <WorkspaceDiffViewer state={fullDiffState} onRequest={requestDiff} />
        )}

        {activeTab === 'log' && (
          <>
            {selectedCommitSha ? (
              <WorkspaceCommitDetail
                sha={selectedCommitSha}
                state={commitDetailState}
                onRequestDetail={requestCommitDetail}
                onClose={handleCloseCommitDetail}
              />
            ) : (
              <WorkspaceGitLog
                commits={gitState.recentCommits}
                hasMore={gitState.hasMoreCommits}
                selectedSha={selectedCommitSha}
                loadingMore={loadingMore}
                onSelectCommit={handleSelectCommit}
                onLoadMore={loadMore}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});
