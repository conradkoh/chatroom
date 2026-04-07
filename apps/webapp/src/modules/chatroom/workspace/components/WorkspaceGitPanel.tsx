'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useState, useCallback, useEffect } from 'react';

import { WorkspaceCommitDetail } from './WorkspaceCommitDetail';
import { WorkspaceDiffViewer } from './WorkspaceDiffViewer';
import { WorkspaceGitBranch } from './WorkspaceGitBranch';
import { WorkspaceGitLog } from './WorkspaceGitLog';
import {
  useWorkspaceGit,
  useFullDiff,
  usePRDiff,
  useCommitDetail,
  useLoadMoreCommits,
  useGitRefresh,
} from '../hooks/useWorkspaceGit';

import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function prStateBadge(state: string, isDraft?: boolean, mergedAt?: string | null) {
  if (isDraft) return { label: 'Draft', cls: 'text-chatroom-text-muted border-chatroom-border' };
  if (state === 'MERGED' || mergedAt) return { label: 'Merged', cls: 'text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-700' };
  if (state === 'CLOSED') return { label: 'Closed', cls: 'text-red-500 dark:text-red-400 border-red-300 dark:border-red-700' };
  return { label: 'Open', cls: 'text-green-600 dark:text-green-400 border-green-300 dark:border-green-700' };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceGitPanelProps {
  machineId: string;
  workingDir: string;
  /** Optional chatroomId to display in the sidebar footer. */
  chatroomId?: string;
  /** Optional initial tab to open. */
  initialTab?: ActiveTab;
}

type ActiveTab = 'prs' | 'diff' | 'log' | 'pr-review';

// ─── Navigation items ─────────────────────────────────────────────────────────

// Base tabs (always shown)
const BASE_TABS: { id: ActiveTab; label: string }[] = [
  { id: 'prs', label: 'PRs' },
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
  initialTab,
}: WorkspaceGitPanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab ?? 'diff');
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [prFilter, setPrFilter] = useState<'open' | 'closed' | 'merged'>('open');

  const gitState = useWorkspaceGit(machineId, workingDir);
  const { state: fullDiffState, request: requestDiff } = useFullDiff(machineId, workingDir);
  const { state: prDiffState, request: requestPRDiff } = usePRDiff(machineId, workingDir);
  const {
    state: commitDetailState,
    request: requestCommitDetail,
    clear: clearCommitDetail,
  } = useCommitDetail(machineId, workingDir);
  const { loading: loadingMore, loadMore } = useLoadMoreCommits(machineId, workingDir);
  const { refresh, isRefreshing } = useGitRefresh(machineId, workingDir);

  // Determine if PR review tab should be shown
  const hasActivePR =
    gitState.status === 'available' && gitState.openPullRequests.length > 0;
  const activePR = hasActivePR ? gitState.openPullRequests[0] : null;

  // PR action mutation
  const requestPRActionMutation = useSessionMutation(api.workspaces.requestPRAction);
  const [prActionLoading, setPrActionLoading] = useState(false);
  const handlePRAction = useCallback(
    async (action: 'merge_squash' | 'merge_no_squash' | 'close') => {
      if (!activePR || prActionLoading) return;
      setPrActionLoading(true);
      try {
        await requestPRActionMutation({
          machineId,
          workingDir,
          prNumber: activePR.number,
          prAction: action,
        });
      } catch (err) {
        console.error('PR action failed:', err);
      } finally {
        setPrActionLoading(false);
      }
    },
    [activePR, prActionLoading, machineId, workingDir, requestPRActionMutation]
  );

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

  // All PRs from the repository
  const allPRs = gitState.status === 'available' ? (gitState.allPullRequests ?? []) : [];

  // Filtered PRs based on current filter
  const filteredPRs = allPRs.filter((pr) => {
    if (prFilter === 'open') return pr.state === 'OPEN';
    if (prFilter === 'closed') return pr.state === 'CLOSED' && !pr.mergedAt;
    if (prFilter === 'merged') return pr.state === 'MERGED' || !!pr.mergedAt;
    return true;
  });

  // Build tabs dynamically
  const tabs = hasActivePR
    ? [...BASE_TABS, { id: 'pr-review' as ActiveTab, label: 'PR Review' }]
    : BASE_TABS;

  // Auto-request PR diff when switching to PR review tab
  // Determine base branch — default to 'master'
  const baseBranch = 'master';

  // Auto-request PR diff when switching to PR review tab
  useEffect(() => {
    if (activeTab === 'pr-review' && hasActivePR && prDiffState.status === 'idle') {
      requestPRDiff(baseBranch);
    }
  }, [activeTab, hasActivePR, prDiffState.status, requestPRDiff, baseBranch]);

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
        {tabs.map((tab) => (
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
          'p-0'
        )}
      >
        {activeTab === 'prs' && (
          <div className="flex flex-col h-full">
            {/* Filter tabs */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-chatroom-border bg-chatroom-bg-surface">
              {(['open', 'closed', 'merged'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setPrFilter(f)}
                  className={cn(
                    'text-[10px] font-bold uppercase tracking-wider px-2 py-1 transition-colors',
                    prFilter === f
                      ? 'text-chatroom-text-primary bg-chatroom-bg-hover'
                      : 'text-chatroom-text-muted hover:text-chatroom-text-secondary'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            {/* PR list */}
            <div className="flex-1 overflow-y-auto">
              {filteredPRs.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-[11px] text-chatroom-text-muted">
                  No pull requests
                </div>
              ) : (
                filteredPRs.map((pr) => {
                  const badge = prStateBadge(pr.state, pr.isDraft, pr.mergedAt);
                  return (
                    <button
                      key={pr.number}
                      type="button"
                      onClick={() => {
                        // Navigate to PR review tab for this PR
                        setActiveTab('pr-review');
                      }}
                      className="w-full text-left px-4 py-3 border-b border-chatroom-border hover:bg-chatroom-bg-hover transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] font-bold text-chatroom-text-muted">
                          #{pr.number}
                        </span>
                        <span className={cn('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 border', badge.cls)}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-xs text-chatroom-text-primary truncate mb-1">
                        {pr.title}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-chatroom-text-muted">
                        <span className="font-mono truncate">
                          {pr.headRefName} → {pr.baseRefName ?? 'main'}
                        </span>
                        {pr.author && (
                          <span>· {pr.author}</span>
                        )}
                        {pr.createdAt && (
                          <span>· {relativeTime(pr.createdAt)}</span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'diff' && (
          <WorkspaceDiffViewer state={fullDiffState} onRequest={requestDiff} />
        )}

        {activeTab === 'pr-review' && (
          <div className="flex flex-col h-full">
            {/* PR header */}
            {activePR && (
              <div className="px-4 py-3 border-b border-chatroom-border bg-chatroom-bg-surface">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-chatroom-text-primary">
                    #{activePR.number}
                  </span>
                  <span className="text-xs text-chatroom-text-secondary truncate">
                    {activePR.title}
                  </span>
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
            )}
            {/* PR action buttons */}
            {activePR && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-chatroom-border">
                <button
                  type="button"
                  onClick={() => handlePRAction('merge_squash')}
                  disabled={prActionLoading}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-accent text-chatroom-bg-primary border border-chatroom-accent transition-all duration-100 hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {prActionLoading ? '...' : 'Merge (Squash)'}
                </button>
                <button
                  type="button"
                  onClick={() => handlePRAction('merge_no_squash')}
                  disabled={prActionLoading}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-chatroom-text-secondary border border-chatroom-border transition-all duration-100 hover:border-chatroom-accent hover:text-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Merge
                </button>
                <button
                  type="button"
                  onClick={() => handlePRAction('close')}
                  disabled={prActionLoading}
                  className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 bg-chatroom-bg-primary text-red-500 dark:text-red-400 border border-red-300 dark:border-red-800 transition-all duration-100 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Close
                </button>
              </div>
            )}
            {/* PR diff content */}
            <div className="flex-1 overflow-y-auto">
              <WorkspaceDiffViewer
                state={prDiffState}
                onRequest={() => requestPRDiff(baseBranch)}
              />
            </div>
          </div>
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
