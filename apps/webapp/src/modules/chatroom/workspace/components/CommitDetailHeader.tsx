'use client';

import { memo, useRef } from 'react';

import { formatRelativeTime } from './shared';
import { useExplorerSelectionKeyboard } from '../hooks/useExplorerSelectionKeyboard';
import type { GitCommit } from '../types/git';

import { linkifyGitHubRefs } from '@/lib/github-refs';

interface CommitDetailHeaderProps {
  commit: GitCommit;
  repoSlug: string | null;
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
}

export const CommitDetailHeader = memo(function CommitDetailHeader({
  commit,
  repoSlug,
  onSendSelectionToComposer,
}: CommitDetailHeaderProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  useExplorerSelectionKeyboard(headerRef, `git:commit:${commit.sha}`, onSendSelectionToComposer);

  return (
    <div
      ref={headerRef}
      className="shrink-0 px-4 py-3 border-b border-border bg-muted/20 overflow-y-auto max-h-48"
    >
      <div className="text-sm font-bold text-foreground mb-1">
        {linkifyGitHubRefs(commit.message, { repoSlug })}
      </div>
      {commit.body ? (
        <div className="text-xs text-muted-foreground whitespace-pre-wrap mb-2">
          {linkifyGitHubRefs(commit.body, { repoSlug })}
        </div>
      ) : null}
      <div className="text-[11px] text-muted-foreground flex items-center gap-2">
        <span className="font-mono">{commit.shortSha}</span>
        <span>·</span>
        <span>{commit.author}</span>
        <span>·</span>
        <span>{formatRelativeTime(commit.date)}</span>
      </div>
    </div>
  );
});
