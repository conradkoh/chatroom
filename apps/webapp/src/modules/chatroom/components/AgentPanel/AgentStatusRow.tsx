'use client';

import { memo } from 'react';

import type { StatusVariant } from '../../utils/agentStatusLabel';

interface AgentStatusRowProps {
  role: string;
  online: boolean;
  statusLabel: string;
  statusVariant?: StatusVariant;
  lastSeenAt?: number | null;
}

/** Formats a lastSeenAt unix-ms timestamp into a human-readable "X ago" string. */
export function formatLastSeen(lastSeenAt: number | null | undefined): string {
  if (lastSeenAt == null) return 'never';
  const diff = Math.floor((Date.now() - lastSeenAt) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Maps a StatusVariant to a Tailwind indicator dot class.
 *
 * Color system:
 *   offline      → grey dot
 *   error        → red dot
 *   transitioning→ yellow dot
 *   ready        → green dot
 *   working      → blue pulse dot
 */
function getIndicatorClass(variant: StatusVariant | undefined, online: boolean): string {
  if (!variant) {
    // Fallback: use legacy online/offline binary
    return online ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';
  }
  switch (variant) {
    case 'offline':
      return 'bg-chatroom-text-muted';
    case 'error':
      return 'bg-red-500 dark:bg-red-400';
    case 'transitioning':
      return 'bg-yellow-500 dark:bg-yellow-400';
    case 'ready':
      return 'bg-chatroom-status-success';
    case 'working':
      return 'bg-chatroom-status-info animate-pulse';
  }
}

/**
 * Maps a StatusVariant to a Tailwind text color class for the label.
 */
function getLabelColorClass(variant: StatusVariant | undefined, online: boolean): string {
  if (!variant) {
    return online ? 'text-chatroom-status-success' : 'text-chatroom-text-muted';
  }
  switch (variant) {
    case 'offline':
      return 'text-chatroom-text-muted';
    case 'error':
      return 'text-red-600 dark:text-red-400';
    case 'transitioning':
      return 'text-yellow-600 dark:text-yellow-400';
    case 'ready':
      return 'text-chatroom-status-success';
    case 'working':
      return 'text-chatroom-status-info';
  }
}

/** Renders the status indicator dot, role name, status label, and last seen timestamp on one line. */
export const AgentStatusRow = memo(function AgentStatusRow({
  role,
  online,
  statusLabel,
  statusVariant,
  lastSeenAt,
}: AgentStatusRowProps) {
  const indicatorClass = getIndicatorClass(statusVariant, online);
  const statusColorClass = getLabelColorClass(statusVariant, online);

  return (
    <div
      className="flex items-center gap-2 min-w-0 overflow-hidden"
      /* Force WebKit compositing layer to prevent Safari ghost rendering artifacts.
         See: https://bugs.webkit.org/show_bug.cgi?id=256725 */
      style={{ transform: 'translateZ(0)' }}
    >
      <div className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`} />
      <span className="text-base font-bold uppercase tracking-wider text-chatroom-text-primary truncate flex-shrink-0">
        {role}
      </span>
      <span
        className={`text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${statusColorClass}`}
      >
        {statusLabel}
      </span>
      <span className="text-[10px] font-bold text-chatroom-text-muted flex-shrink-0">·</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted truncate">
        {formatLastSeen(lastSeenAt)}
      </span>
    </div>
  );
});
