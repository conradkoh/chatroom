'use client';

import { memo } from 'react';

import type { StatusVariant } from '../../utils/agentStatusLabel';

interface AgentStatusRowProps {
  role: string;
  online: boolean;
}

/** Formats a lastSeenAt unix-ms timestamp into a human-readable "X ago" string. */
export function formatLastSeen(lastSeenAt: number | null | undefined): string {
  if (lastSeenAt == null) return 'never';
  const diff = Math.floor((Date.now() - lastSeenAt) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  return Math.floor(diff / 3600) + 'h ago';
}

export function getIndicatorClass(variant: StatusVariant | undefined, online: boolean): string {
  if (!variant) {
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

export function getLabelColorClass(variant: StatusVariant | undefined, online: boolean): string {
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
      return 'text-chatroom-status-info animate-pulse';
  }
}

/** Row background highlight for actively working agents. */
export function getRowHighlightClass(variant: StatusVariant | undefined): string {
  return variant === 'working' ? 'bg-chatroom-status-info/5' : '';
}

/** Renders the status indicator dot and role name. */
export const AgentStatusRow = memo(function AgentStatusRow({ role, online }: AgentStatusRowProps) {
  return (
    <div
      className="flex items-center gap-2 min-w-0 overflow-hidden"
      style={{ transform: 'translateZ(0)' }}
    >
      <div className={'w-2.5 h-2.5 flex-shrink-0 ' + getIndicatorClass(undefined, online)} />
      <span className="text-base font-bold uppercase tracking-wider text-chatroom-text-primary truncate flex-shrink-0">
        {role}
      </span>
    </div>
  );
});
