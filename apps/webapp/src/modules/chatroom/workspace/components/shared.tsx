'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { memo } from 'react';

import type { DiffStat } from '../types/git';

// ─── InlineDiffStat ──────────────────────────────────────────────────────────

interface InlineDiffStatProps {
  diffStat: DiffStat;
  /** Whether to include file count (e.g. "3 files · +45 −12"). Default: true. */
  showFileCount?: boolean;
  /** Unpushed commits vs upstream. */
  commitsAhead?: number;
  /** Unpulled commits on upstream. */
  commitsBehind?: number;
  /** When true, show one-click sync when ahead/behind. */
  syncEnabled?: boolean;
  isSyncing?: boolean;
  onSync?: () => void;
}

function SyncStatusBadges({
  commitsAhead,
  commitsBehind,
}: {
  commitsAhead: number;
  commitsBehind: number;
}) {
  return (
    <>
      {commitsAhead > 0 && (
        <span className="text-chatroom-status-warning" title="Unpushed commits">
          ↑{commitsAhead}
        </span>
      )}
      {commitsBehind > 0 && (
        <span className="text-chatroom-accent" title="Commits behind remote">
          ↓{commitsBehind}
        </span>
      )}
    </>
  );
}

/**
 * Renders a compact one-line diff stat summary.
 *
 * Variants:
 * - With file count: "3 files · +45 −12"
 * - Without file count: "+45 −12"
 * - Clean tree, in sync: "Clean"
 * - Clean tree, ahead/behind: "↑2 ↓1" with optional Sync button
 */
export const InlineDiffStat = memo(function InlineDiffStat({
  diffStat,
  showFileCount = true,
  commitsAhead = 0,
  commitsBehind = 0,
  syncEnabled = false,
  isSyncing = false,
  onSync,
}: InlineDiffStatProps) {
  const { filesChanged, insertions, deletions } = diffStat;
  const isClean = filesChanged === 0 && insertions === 0 && deletions === 0;
  const hasSyncDelta = commitsAhead > 0 || commitsBehind > 0;
  const showSyncButton = syncEnabled && hasSyncDelta && onSync;

  if (isClean && !hasSyncDelta) {
    return <span className="text-[11px] text-chatroom-text-muted flex items-center">Clean</span>;
  }

  if (isClean && hasSyncDelta) {
    return (
      <span className="text-[11px] text-chatroom-text-muted flex items-center gap-1.5">
        <SyncStatusBadges commitsAhead={commitsAhead} commitsBehind={commitsBehind} />
        {showSyncButton && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSync();
            }}
            disabled={isSyncing}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-chatroom-accent hover:text-chatroom-text-primary disabled:opacity-50"
            title="Pull then push"
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync
          </button>
        )}
      </span>
    );
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
      {hasSyncDelta && (
        <>
          <span>·</span>
          <SyncStatusBadges commitsAhead={commitsAhead} commitsBehind={commitsBehind} />
        </>
      )}
      {showSyncButton && (
        <>
          <span>·</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSync();
            }}
            disabled={isSyncing}
            className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-chatroom-accent hover:text-chatroom-text-primary disabled:opacity-50"
            title="Pull then push"
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Sync
          </button>
        </>
      )}
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
  if (days < 365) {
    const months = Math.round(days / 30.44); // average days per month
    return `${months}mo ago`;
  }
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}
