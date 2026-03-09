'use client';

import { memo } from 'react';

interface AgentStatusRowProps {
  role: string;
  online: boolean;
  statusLabel: string;
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

/** Renders the status indicator dot, role name, status label, and last seen timestamp on one line. */
export const AgentStatusRow = memo(function AgentStatusRow({
  role,
  online,
  statusLabel,
  lastSeenAt,
}: AgentStatusRowProps) {
  const indicatorClass = online ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted';
  const statusColorClass = online ? 'text-chatroom-status-success' : 'text-chatroom-text-muted';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-2.5 h-2.5 flex-shrink-0 ${indicatorClass}`} />
      <span className="text-base font-bold uppercase tracking-wider text-chatroom-text-primary">
        {role}
      </span>
      <span className={`text-[10px] font-bold uppercase tracking-wide ${statusColorClass}`}>
        {statusLabel}
      </span>
      <span className="text-[10px] font-bold text-chatroom-text-muted">·</span>
      <span className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
        {formatLastSeen(lastSeenAt)}
      </span>
    </div>
  );
});
