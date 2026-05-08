'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useListSessions } from '../hooks/useListSessions';
import { StatusDot } from './StatusDot';
import { relativeTime } from '../utils';

interface SessionListProps {
  workspaceId: Id<'chatroom_workspaces'>;
  selectedSessionId: Id<'chatroom_harnessSessions'> | null;
  onSelect: (id: Id<'chatroom_harnessSessions'>) => void;
}

export const SessionList = memo(function SessionList({
  workspaceId,
  selectedSessionId,
  onSelect,
}: SessionListProps) {
  const sessions = useListSessions(workspaceId);

  if (!sessions || sessions.length === 0) {
    return <div className="flex-1" />;
  }

  const sorted = [...sessions].reverse();

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col py-1">
        {sorted.map((s) => {
          const label = s.sessionTitle ?? s.lastUsedConfig.agent;
          const isSelected = s._id === selectedSessionId;
          return (
            <button
              key={s._id}
              onClick={() => onSelect(s._id)}
              className={cn(
                'w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/40 text-foreground'
              )}
            >
              <StatusDot status={s.status} className="mt-0.5 shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="text-sm block truncate">{label}</span>
                <span className="text-xs text-muted-foreground">{relativeTime(s.lastActiveAt)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
});
