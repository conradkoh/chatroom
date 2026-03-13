'use client';

import { memo } from 'react';
import type { DiffStat } from '../types/git';

// ─── InlineDiffStat ──────────────────────────────────────────────────────────

interface InlineDiffStatProps {
  diffStat: DiffStat;
  /** Whether to include file count (e.g. "3 files · +45 −12"). Default: true. */
  showFileCount?: boolean;
}

/**
 * Renders a compact one-line diff stat summary.
 *
 * Variants:
 * - With file count: "3 files · +45 −12"
 * - Without file count: "+45 −12"
 * - Clean state: "Clean"
 */
export const InlineDiffStat = memo(function InlineDiffStat({
  diffStat,
  showFileCount = true,
}: InlineDiffStatProps) {
  const { filesChanged, insertions, deletions } = diffStat;
  const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;

  if (isClean) {
    return <span className="text-[11px] text-chatroom-text-muted">Clean</span>;
  }

  return (
    <span className="text-[11px] text-chatroom-text-muted flex items-center gap-1">
      {showFileCount && (
        <>
          <span>
            {filesChanged} {filesChanged === 1 ? 'file' : 'files'}
          </span>
          <span>·</span>
        </>
      )}
      <span className="text-chatroom-status-success">+{insertions}</span>
      <span className="text-chatroom-status-error">−{deletions}</span>
    </span>
  );
});

// ─── formatRelativeTime ──────────────────────────────────────────────────────

/**
 * Formats a timestamp (unix ms or ISO string) as a relative "ago" string.
 *
 * Examples: "just now", "30s ago", "5m ago", "2h ago", "3d ago", "1mo ago"
 */
export function formatRelativeTime(timestamp: number | string): string {
  const then = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const diffMs = Date.now() - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
