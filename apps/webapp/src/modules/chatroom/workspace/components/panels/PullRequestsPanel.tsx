'use client';

/**
 * PullRequestsPanel — master-detail PR browser for the ActivityBar.
 *
 * Left column: filter dropdown + PR list (default filter: my-prs)
 * Right column: PR review (WorkspacePRReview) for the selected PR
 *
 * Default selection: current-branch PR (from gitState.openPullRequests[0])
 * Falls back to first PR in the filtered list if no current-branch PR.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { GitPullRequest as GitPullRequestIcon, Loader2, Star } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { useCurrentBranchPullRequest } from '../../hooks/useCurrentBranchPullRequest';
import { useAllPullRequests } from '../../hooks/useWorkspaceGit';
import type { GitPullRequest } from '../../types/git';
import { prStateBadge, relativeTime } from '../../utils/pr-helpers';
import { WorkspacePRReview } from '../WorkspacePRReview';

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { isValidTwoPaneLayout } from '@/modules/chatroom/hooks/twoPaneLayout';
import { usePersistedState } from '@/modules/chatroom/hooks/usePersistedState';

// ─── Types ────────────────────────────────────────────────────────────────────

type PRFilter = 'my-prs' | 'all-open' | 'all';

const FILTER_LABELS: Record<PRFilter, string> = {
  'my-prs': 'My PRs',
  'all-open': 'All Open',
  all: 'All',
};

interface PullRequestsPanelProps {
  machineId: string;
  workingDir: string;
}

// ─── PR List Item ─────────────────────────────────────────────────────────────

interface PRListItemProps {
  pr: GitPullRequest;
  isSelected: boolean;
  isCurrentBranch: boolean;
  onSelect: (pr: GitPullRequest) => void;
}

const PRListItem = memo(function PRListItem({
  pr,
  isSelected,
  isCurrentBranch,
  onSelect,
}: PRListItemProps) {
  const badge = prStateBadge(pr.state);

  return (
    <button
      type="button"
      onClick={() => onSelect(pr)}
      className={cn(
        'w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors hover:bg-chatroom-bg-hover cursor-pointer',
        isSelected
          ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
          : 'border-l-2 border-transparent'
      )}
    >
      {/* PR number + title + current-branch indicator */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-mono text-chatroom-accent shrink-0">#{pr.prNumber}</span>
        <span className="text-xs text-chatroom-text-primary truncate flex-1">{pr.title}</span>
        {isCurrentBranch && (
          <span title="Current branch PR">
            <Star size={11} className="text-yellow-500 shrink-0" />
          </span>
        )}
      </div>
      {/* Author + state + date */}
      <div className="flex items-center gap-1.5 text-[11px] text-chatroom-text-muted">
        {pr.author && <span className="truncate">{pr.author}</span>}
        <span>·</span>
        <span className={cn('shrink-0', badge.cls)}>{badge.label}</span>
        {pr.createdAt && (
          <>
            <span>·</span>
            <span className="shrink-0">{relativeTime(pr.createdAt)}</span>
          </>
        )}
      </div>
    </button>
  );
});

// ─── PR List Column ───────────────────────────────────────────────────────────

interface PRListColumnProps {
  prs: GitPullRequest[];
  filter: PRFilter;
  selectedPR: GitPullRequest | null;
  currentBranchPR: GitPullRequest | null;
  isLoading: boolean;
  onSelect: (pr: GitPullRequest) => void;
  onFilterChange: (f: PRFilter) => void;
}

const PRListColumn = memo(function PRListColumn({
  prs,
  filter,
  selectedPR,
  currentBranchPR,
  isLoading,
  onSelect,
  onFilterChange,
}: PRListColumnProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <Select value={filter} onValueChange={(v) => onFilterChange(v as PRFilter)}>
          <SelectTrigger
            size="sm"
            className="w-full text-xs bg-chatroom-bg-surface border border-chatroom-border text-chatroom-text-primary rounded-none focus:ring-0 focus:outline-none"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-chatroom-bg-surface border border-chatroom-border rounded-none">
            {(Object.keys(FILTER_LABELS) as PRFilter[]).map((f) => (
              <SelectItem key={f} value={f} className="text-xs rounded-none">
                {FILTER_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-20 gap-1.5 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Loading PRs…
          </div>
        ) : prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 px-4 text-center">
            <GitPullRequestIcon size={20} className="text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              No PRs match &ldquo;{FILTER_LABELS[filter]}&rdquo;.
            </p>
          </div>
        ) : (
          prs.map((pr) => (
            <PRListItem
              key={pr.prNumber ?? pr.url}
              pr={pr}
              isSelected={selectedPR?.prNumber === pr.prNumber}
              isCurrentBranch={currentBranchPR?.prNumber === pr.prNumber}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
});

// ─── Layout Persistence ─────────────────────────────────────────────────────

const PR_LAYOUT_KEY = 'webapp:pullRequestsPanelSizes';
const PR_DEFAULT_LAYOUT: readonly number[] = [30, 70] as const;
const isValidPRLayout = isValidTwoPaneLayout;

// ─── Main Component ───────────────────────────────────────────────────────────

export const PullRequestsPanel = memo(function PullRequestsPanel({
  machineId,
  workingDir,
}: PullRequestsPanelProps) {
  const [filter, setFilter] = useState<PRFilter>('my-prs');
  const [selectedPR, setSelectedPR] = useState<GitPullRequest | null>(null);
  // Layout persistence
  const [sizes, setSizes] = usePersistedState<number[]>(PR_LAYOUT_KEY, [...PR_DEFAULT_LAYOUT], {
    validate: isValidPRLayout,
  });
  const handleLayoutChanged = useCallback(
    (layout: { [id: string]: number }) => {
      const next = [layout['pr-list'] ?? sizes[0], layout['pr-detail'] ?? sizes[1]];
      if (isValidPRLayout(next)) setSizes(next);
    },
    [setSizes, sizes]
  );
  const [prActionLoading, setPrActionLoading] = useState(false);
  const [prActionError, setPrActionError] = useState<string | null>(null);

  // Current branch PR + current user login
  const { currentBranchPR, currentUserLogin } = useCurrentBranchPullRequest(machineId, workingDir);

  // All PRs for this workspace
  const { state: allPRsState, request: requestAllPRs } = useAllPullRequests(machineId, workingDir);

  // PR action mutation (merge, close, etc.)
  const requestPRActionMutation = useSessionMutation(api.workspaces.requestPRAction);

  // Request PRs on mount
  useEffect(() => {
    if (machineId && workingDir) {
      requestAllPRs();
    }
  }, [machineId, workingDir, requestAllPRs]);

  // All PRs array
  const allPRs: GitPullRequest[] = useMemo(() => {
    if (allPRsState.status === 'available') return allPRsState.pullRequests;
    return [];
  }, [allPRsState]);

  // Filtered PRs
  const filteredPRs = useMemo(() => {
    switch (filter) {
      case 'my-prs':
        if (!currentUserLogin) return allPRs.filter((pr) => pr.state === 'OPEN');
        return allPRs.filter((pr) => pr.author === currentUserLogin);
      case 'all-open':
        return allPRs.filter((pr) => pr.state === 'OPEN');
      case 'all':
        return allPRs;
    }
  }, [allPRs, filter, currentUserLogin]);

  // Auto-select: prefer current-branch PR, then first in filtered list
  useEffect(() => {
    if (selectedPR !== null) return; // already selected
    if (filteredPRs.length === 0) return;

    // Default-select current-branch PR if it's in the filtered list
    if (currentBranchPR) {
      const inList = filteredPRs.find((pr) => pr.prNumber === currentBranchPR.prNumber);
      if (inList) {
        setSelectedPR(inList);
        return;
      }
    }
    // Fall back to first in list
    setSelectedPR(filteredPRs[0] ?? null);
  }, [filteredPRs, currentBranchPR, selectedPR]);

  // Reset selection when filter changes so auto-select re-fires
  const handleFilterChange = useCallback((f: PRFilter) => {
    setFilter(f);
    setSelectedPR(null);
  }, []);

  const handlePRAction = useCallback(
    async (action: 'merge_squash' | 'merge_no_squash' | 'close') => {
      if (!selectedPR || prActionLoading) return;
      const { prNumber } = selectedPR;
      if (prNumber == null) return;
      setPrActionLoading(true);
      setPrActionError(null);
      try {
        await requestPRActionMutation({
          machineId,
          workingDir,
          prNumber,
          prAction: action,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[PullRequestsPanel] PR action failed:', err);
        setPrActionError(message);
      } finally {
        setPrActionLoading(false);
      }
    },
    [selectedPR, prActionLoading, requestPRActionMutation, machineId, workingDir]
  );

  const isLoading = allPRsState.status === 'idle' || allPRsState.status === 'loading';
  const baseBranch = selectedPR?.baseRefName ?? 'main';

  return (
    <ResizablePanelGroup className="h-full" onLayoutChanged={handleLayoutChanged}>
      {/* ── Left: PR List ────────────────────────────────────── */}
      <ResizablePanel id="pr-list" defaultSize={sizes[0]} minSize={18}>
        <div className="flex flex-col h-full overflow-hidden">
          <PRListColumn
            prs={filteredPRs}
            filter={filter}
            selectedPR={selectedPR}
            currentBranchPR={currentBranchPR}
            isLoading={isLoading}
            onSelect={setSelectedPR}
            onFilterChange={handleFilterChange}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* ── Right: PR Review ──────────────────────────────────── */}
      <ResizablePanel id="pr-detail" defaultSize={sizes[1]} minSize={30}>
        <div className="flex flex-col h-full overflow-hidden">
          {!selectedPR ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              {isLoading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" />
                  Loading…
                </span>
              ) : (
                'Select a pull request to review.'
              )}
            </div>
          ) : (
            <WorkspacePRReview
              key={selectedPR.prNumber}
              activePR={selectedPR}
              machineId={machineId}
              workingDir={workingDir}
              baseBranch={baseBranch}
              onPRAction={handlePRAction}
              prActionLoading={prActionLoading}
              prActionError={prActionError}
            />
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
