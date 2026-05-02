'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { memo } from 'react';


import { StatusDot } from './StatusDot';
import { relativeTime } from './utils';

import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionListProps {
  workspaceId: Id<'chatroom_workspaces'>;
  selectedSessionId: Id<'chatroom_harnessSessions'> | null;
  onSelect: (id: Id<'chatroom_harnessSessions'>) => void;
}

// ─── SessionList ──────────────────────────────────────────────────────────────

export const SessionList = memo(function SessionList({
  workspaceId,
  selectedSessionId,
  onSelect,
}: SessionListProps) {
  const sessions = useSessionQuery(api.chatroom.directHarness.sessions.listSessionsByWorkspace, {
    workspaceId,
  });

  if (sessions === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">
        Loading sessions…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
        No sessions yet — click New Session to start one.
      </div>
    );
  }

  // Reverse so newest (highest createdAt) is on top
  const sorted = [...sessions].reverse();

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col">
        {sorted.map((s) => (
          <button
            key={s._id}
            className={cn(
              'px-3 py-2 flex items-center gap-2 cursor-pointer w-full text-left',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              s._id === selectedSessionId
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            )}
            onClick={() => onSelect(s._id)}
          >
            <StatusDot status={s.status} />
            <span className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground block truncate">
                {s.lastUsedConfig.agent}
              </span>
              <span className="text-xs text-muted-foreground">{relativeTime(s.lastActiveAt)}</span>
            </span>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
});
