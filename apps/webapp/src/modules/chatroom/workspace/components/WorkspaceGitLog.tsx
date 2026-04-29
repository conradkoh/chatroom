'use client';

import { Loader2 } from 'lucide-react';
import { memo } from 'react';

import { formatRelativeTime } from './shared';
import type { GitCommit } from '../types/git';

import { Button } from '@/components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceGitLogProps {
  commits: GitCommit[];
  hasMore: boolean;
  status?: 'idle' | 'loading' | 'available';
  selectedSha: string | null;
  loadingMore: boolean;
  onSelectCommit: (sha: string) => void;
  onRequest: () => void;
  onLoadMore: () => void;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface CommitRowProps {
  commit: GitCommit;
  isSelected: boolean;
  onSelect: (sha: string) => void;
}

const CommitRow = memo(function CommitRow({ commit, isSelected, onSelect }: CommitRowProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(commit.sha)}
      className={[
        'w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors',
        'hover:bg-chatroom-bg-hover cursor-pointer',
        isSelected
          ? 'bg-chatroom-bg-hover border-l-2 border-chatroom-accent'
          : 'border-l-2 border-transparent',
      ].join(' ')}
    >
      {/* First line: SHA + message */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-[11px] text-chatroom-accent shrink-0">
          {commit.shortSha}
        </span>
        <span className="text-xs text-chatroom-text-primary truncate">{commit.message}</span>
      </div>
      {/* Second line: author + relative date */}
      <div className="flex items-center gap-2 text-[11px] text-chatroom-text-muted">
        <span>{commit.author}</span>
        <span>·</span>
        <span>{formatRelativeTime(commit.date)}</span>
      </div>
    </button>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * Scrollable git commit log with selection, load-more, and empty state.
 */
export const WorkspaceGitLog = memo(function WorkspaceGitLog({
  commits,
  hasMore,
  status = 'available',
  selectedSha,
  loadingMore,
  onSelectCommit,
  onRequest,
  onLoadMore,
}: WorkspaceGitLogProps) {
  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 px-3 text-center">
        <div className="text-xs text-chatroom-text-muted">Commit history loads on demand</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRequest}
          className="text-xs text-chatroom-text-secondary"
        >
          Load commits
        </Button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-32 gap-1.5 text-xs text-chatroom-text-muted">
        <Loader2 size={12} className="animate-spin" />
        Loading commits…
      </div>
    );
  }

  if (commits.length === 0) {
    return <div className="text-xs text-chatroom-text-muted px-3 py-2">No commits</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Commit list */}
      <div className="overflow-y-auto divide-y divide-chatroom-border flex-1">
        {commits.map((commit) => (
          <CommitRow
            key={commit.sha}
            commit={commit}
            isSelected={selectedSha === commit.sha}
            onSelect={onSelectCommit}
          />
        ))}
      </div>

      {/* Load More */}
      {hasMore && (
        <div className="px-3 py-1 border-t border-chatroom-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="text-xs text-chatroom-text-secondary w-full gap-1.5"
          >
            {loadingMore && <Loader2 size={12} className="animate-spin" />}
            {loadingMore ? 'Loading…' : 'Load more commits'}
          </Button>
        </div>
      )}
    </div>
  );
});
