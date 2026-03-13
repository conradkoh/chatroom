'use client';

import { memo } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { GitCommit } from '../../types/git';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkspaceGitLogProps {
  commits: GitCommit[];
  hasMore: boolean;
  selectedSha: string | null;
  loadingMore: boolean;
  onSelectCommit: (sha: string) => void;
  onLoadMore: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeDate(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
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
      <div className="flex items-center gap-2 text-[10px] text-chatroom-text-muted">
        <span>{commit.author}</span>
        <span>·</span>
        <span>{formatRelativeDate(commit.date)}</span>
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
  selectedSha,
  loadingMore,
  onSelectCommit,
  onLoadMore,
}: WorkspaceGitLogProps) {
  if (commits.length === 0) {
    return (
      <div className="text-[11px] text-chatroom-text-muted px-3 py-2">No commits</div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Commit list */}
      <div className="max-h-[400px] overflow-y-auto divide-y divide-chatroom-border">
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
