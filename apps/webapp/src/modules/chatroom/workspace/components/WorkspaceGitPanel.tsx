'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { memo, useState, useCallback, useEffect } from 'react';

import { PRDetailModal } from '../../components/PRDetailModal';
import { PRActionButtons } from './PRActionButtons';

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

import { prStateBadge, relativeTime } from '../utils/pr-helpers';


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
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab ?? 'prs');
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [prFilter, setPrFilter] = useState<'open' | 'closed' | 'merged'>('open');
  const [prDetailOpen, setPrDetailOpen] = useState(false);
  const [selectedPR, setSelectedPR] = useState<import('../types/git').GitPullRequest | null>(null);

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

  // PR action from the detail modal (any PR, not just activePR)
  const handlePRDetailAction = useCallback(
    async (prNumber: number, action: 'merge_squash' | 'merge_no_squash' | 'close') => {
      if (prActionLoading) return;
      setPrActionLoading(true);
      try {
        await requestPRActionMutation({
          machineId,
          workingDir,
          prNumber,
          prAction: action,
        });
      } catch (err) {
        console.error('PR action failed:', err);
      } finally {
        setPrActionLoading(false);
      }
    },
    [prActionLoading, machineId, workingDir, requestPRActionMutation]
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

  // Build tabs — Current Branch tab always shown
  const tabs: { id: ActiveTab; label: string }[] = [
    ...BASE_TABS,
    { id: 'pr-review' as ActiveTab, label: 'Current Branch' },
  ];

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
    <>
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
                        setSelectedPR(pr);
                        setPrDetailOpen(true);
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
            {activePR ? (
              <>
                {/* PR header */}
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
                {/* PR action buttons */}
                <div className="px-4 py-2 border-b border-chatroom-border">
                  <PRActionButtons onAction={handlePRAction} loading={prActionLoading} />
                </div>
                {/* PR diff content */}
                <div className="flex-1 overflow-y-auto">
                  <WorkspaceDiffViewer
                    state={prDiffState}
                    onRequest={() => requestPRDiff(baseBranch)}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                <div className="text-chatroom-text-muted text-[11px]">
                  No pull request found for branch <span className="font-mono font-bold text-chatroom-text-secondary">{gitState.status === 'available' ? gitState.branch : ''}</span>
                </div>
                <div className="text-[10px] text-chatroom-text-muted">
                  Create a pull request to see the diff and merge options here.
                </div>
              </div>
            )}
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

    {/* PR Detail Modal */}
    {selectedPR && (
      <PRDetailModal
        isOpen={prDetailOpen}
        onClose={() => {
          setPrDetailOpen(false);
          setSelectedPR(null);
        }}
        pr={selectedPR}
        machineId={machineId}
        workingDir={workingDir}
        onPRAction={handlePRDetailAction}
        prActionLoading={prActionLoading}
      />
    )}
    </>
  );
});
