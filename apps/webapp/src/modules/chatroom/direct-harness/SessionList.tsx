'use client';

/**
 * SessionList — list of harness sessions for a workspace.
 * Shows agent name, lastActiveAt, and status badge.
 */

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface SessionListProps {
  workspaceId: string;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

type SessionStatus = 'pending' | 'spawning' | 'active' | 'idle' | 'closed' | 'failed';

function statusBadgeClass(status: SessionStatus): string {
  switch (status) {
    case 'active':
      return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400 border-green-500/30';
    case 'idle':
      return 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400 border-yellow-500/30';
    case 'pending':
    case 'spawning':
      return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/30';
    case 'closed':
      return 'bg-muted text-muted-foreground border-border';
    case 'failed':
      return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-500/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function formatRelativeTime(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SessionList({ workspaceId, selectedSessionId, onSelect }: SessionListProps) {
  const sessions = useSessionQuery(api.chatroom.directHarness.sessions.listSessionsByWorkspace, {
    workspaceId: workspaceId as Id<'chatroom_workspaces'>,
  });

  if (sessions !== undefined && sessions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No sessions in this workspace. Click &lsquo;New session&rsquo; to start.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground font-medium">Sessions</label>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {(sessions ?? []).map((session) => (
          <button
            key={session._id}
            onClick={() => onSelect(session._id)}
            className={cn(
              'w-full text-left px-2 py-1.5 rounded-sm text-xs transition-colors',
              'hover:bg-accent/50',
              selectedSessionId === session._id
                ? 'bg-accent text-foreground'
                : 'text-foreground'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{session.agent}</span>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] px-1 py-0 h-4 shrink-0 border',
                  statusBadgeClass(session.status as SessionStatus)
                )}
              >
                {session.status}
              </Badge>
            </div>
            <div className="text-muted-foreground text-[10px] mt-0.5">
              {formatRelativeTime(session.lastActiveAt)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
