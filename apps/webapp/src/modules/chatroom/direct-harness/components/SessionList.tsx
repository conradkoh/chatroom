'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { StatusDot } from './StatusDot';
import { relativeTime } from '../utils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a legible display title for a session.
 * OpenCode uses "New session - <ISO timestamp>" as the default title before the
 * model has a chance to rename it. That raw timestamp is noise in the list, so
 * we fall back to the agent name in that case.
 */
export function displaySessionTitle(s: {
  sessionTitle?: string | null;
  lastUsedConfig: { agent: string };
}): string {
  const t = s.sessionTitle?.trim();
  const isDefault = !t || /^new session\s*-\s*\d{4}-\d{2}-\d{2}t/i.test(t);
  return isDefault ? s.lastUsedConfig.agent : t!;
}

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
  const sessions = useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    workspaceId ? { workspaceId } : 'skip'
  );

  if (!sessions || sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">No sessions yet</p>
      </div>
    );
  }

  const sorted = [...sessions].reverse();

  return (
    <>
      {/* Section header */}
      <div className="shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b-2 border-border">
        Sessions
      </div>

      {/* Session rows — native scroll respects child width constraints so truncate works */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.map((s) => {
          const label = displaySessionTitle(s);
          const isSelected = s._id === selectedSessionId;
          return (
            <button
              key={s._id}
              onClick={() => onSelect(s._id)}
              className={cn(
                'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/40 text-foreground'
              )}
            >
              <StatusDot status={s.status} className="shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-xs font-bold uppercase tracking-wide">
                  {label}
                </span>
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                  {relativeTime(s.lastActiveAt)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
});
