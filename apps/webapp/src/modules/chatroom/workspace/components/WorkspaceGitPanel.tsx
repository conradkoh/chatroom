'use client';

import { RefreshCw } from 'lucide-react';
import { memo, useState, useCallback, useEffect } from 'react';

import { WorkspaceCommitDetail } from './WorkspaceCommitDetail';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';
import { WorkspaceGitBranch } from './WorkspaceGitBranch';
import { WorkspaceGitLog } from './WorkspaceGitLog';
import {
  useWorkspaceGit,
  useFullDiff,
  useCommitDetail,
  useLoadMoreCommits,
  useGitRefresh,
} from '../hooks/useWorkspaceGit';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceGitPanelProps {
  machineId: string;
  workingDir: string;
  /** Optional chatroomId to display in the sidebar footer. */
  chatroomId?: string;
}

type ActiveTab = 'diff' | 'log';

// ─── Navigation items ─────────────────────────────────────────────────────────

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'diff', label: 'Changes' },
  { id: 'log', label: 'History' },
];

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Container panel for workspace git info.
 *
 * Renders a sidebar navigation on the left and content area on the right.
 * Fetches git state and wires child components together with
 * tab switching and commit selection state.
 */
export const WorkspaceGitPanel = memo(function WorkspaceGitPanel({
  machineId,
  workingDir,
  chatroomId,
}: WorkspaceGitPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('diff');
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);

  const gitState = useWorkspaceGit(machineId, workingDir);
  const { state: fullDiffState, request: requestDiff } = useFullDiff(machineId, workingDir);
  const {
    state: commitDetailState,
    request: requestCommitDetail,
    clear: clearCommitDetail,
  } = useCommitDetail(machineId, workingDir);
  const { loading: loadingMore, loadMore } = useLoadMoreCommits(machineId, workingDir);
  const { refresh, isRefreshing } = useGitRefresh(machineId, workingDir);

  const handleSelectCommit = useCallback(
    (sha: string) => {
      clearCommitDetail(); // reset so it loads fresh
      setSelectedCommitSha(sha);
    },
    [clearCommitDetail]
  );

  const handleCloseCommitDetail = useCallback(() => {
    setSelectedCommitSha(null);
    clearCommitDetail();
  }, [clearCommitDetail]);

  // Auto-load diff when the panel mounts or machineId/workingDir change
  useEffect(() => {
    requestDiff();
  }, [requestDiff]);

  // Auto-select first commit when switching to log tab
  useEffect(() => {
    if (
      activeTab === 'log' &&
      !selectedCommitSha &&
      gitState.status === 'available' &&
      gitState.recentCommits.length > 0
    ) {
      handleSelectCommit(gitState.recentCommits[0]!.sha);
    }
  }, [activeTab, selectedCommitSha, gitState, handleSelectCommit]);

  // For non-available states, render without sidebar (simple single-pane view)
  if (gitState.status !== 'available') {
    return (
      <div className="p-4">
        <WorkspaceGitBranch state={gitState} />
      </div>
    );
  }

  return (
    <div className="flex flex-row h-full">
      {/* Side panel */}
      <div className="w-40 flex-shrink-0 border-r-2 border-chatroom-border overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="px-3 pt-3 pb-2 border-b border-chatroom-border flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Git
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={isRefreshing}
            className="text-chatroom-text-muted hover:text-chatroom-text-secondary transition-colors disabled:opacity-50"
            title="Sync git state"
          >
            <RefreshCw size={11} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Navigation items */}
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
              'w-full text-left px-3 py-2 flex items-center gap-1.5 transition-colors',
              activeTab === tab.id
                ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
                : 'border-l-2 border-transparent hover:bg-chatroom-bg-hover/50'
            )}
          >
            <span
              className={cn(
                'text-[11px] font-medium',
                activeTab === tab.id ? 'text-chatroom-text-primary' : 'text-chatroom-text-secondary'
              )}
            >
              {tab.label}
            </span>
          </button>
        ))}

        {/* Chatroom details — pushed to bottom */}
        {chatroomId && (
          <div className="mt-auto px-3 py-3 border-t border-chatroom-border">
            <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted mb-1">
              Chatroom ID
            </div>
            <div className="font-mono text-[10px] font-bold text-chatroom-text-secondary break-all p-1.5 bg-chatroom-bg-tertiary">
              {chatroomId}
            </div>
          </div>
        )}
      </div>

      {/* Content area */}
      <div
        className={cn(
          'flex-1 overflow-y-auto',
          activeTab === 'diff' || activeTab === 'log' ? 'p-0' : 'p-4'
        )}
      >
        {activeTab === 'diff' && (
          <WorkspaceDiffViewer state={fullDiffState} onRequest={requestDiff} />
        )}

        {activeTab === 'log' && (
          <div className="flex flex-row h-full">
            {/* Column 2: Commit list */}
            <div className="w-64 shrink-0 border-r border-chatroom-border overflow-y-auto">
              <WorkspaceGitLog
                commits={gitState.recentCommits}
                hasMore={gitState.hasMoreCommits}
                selectedSha={selectedCommitSha}
                loadingMore={loadingMore}
                onSelectCommit={handleSelectCommit}
                onLoadMore={loadMore}
              />
            </div>

            {/* Columns 3-4: Commit detail (file list + diff) */}
            <div className="flex-1 min-w-0">
              {selectedCommitSha ? (
                <WorkspaceCommitDetail
                  sha={selectedCommitSha}
                  state={commitDetailState}
                  onRequestDetail={requestCommitDetail}
                  onClose={handleCloseCommitDetail}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-[11px] text-chatroom-text-muted">
                  Select a commit to view details
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
