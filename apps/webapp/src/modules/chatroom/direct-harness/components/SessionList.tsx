'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { memo, type MouseEvent } from 'react';

import { SessionListRow } from './SessionListRow';

export { displaySessionTitle } from '../utils/displaySessionTitle';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionListProps {
  workspaceId: Id<'chatroom_workspaces'>;
  selectedSessionId: Id<'chatroom_harnessSessions'> | null;
  onSelect: (id: Id<'chatroom_harnessSessions'>) => void;
  optimisticallyClosedIds: ReadonlySet<string>;
  closingIds: ReadonlySet<string>;
  onCloseSession: (harnessSessionId: Id<'chatroom_harnessSessions'>) => Promise<void>;
}

// ─── SessionList ──────────────────────────────────────────────────────────────

export const SessionList = memo(function SessionList({
  workspaceId,
  selectedSessionId,
  onSelect,
  optimisticallyClosedIds,
  closingIds,
  onCloseSession,
}: SessionListProps) {
  const sessions = useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    workspaceId ? { workspaceId } : 'skip'
  );

  const handleClose = async (e: MouseEvent, harnessSessionId: Id<'chatroom_harnessSessions'>) => {
    e.stopPropagation();
    e.preventDefault();
    if (closingIds.has(harnessSessionId)) return;
    await onCloseSession(harnessSessionId);
  };

  if (!sessions || sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          No sessions yet
        </p>
      </div>
    );
  }

  const sorted = [...sessions].reverse();

  return (
    <>
      <div className="shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b-2 border-border">
        Sessions
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sorted.map((s) => (
          <SessionListRow
            key={s._id}
            session={s}
            isSelected={s._id === selectedSessionId}
            optimisticallyClosedIds={optimisticallyClosedIds}
            isClosing={closingIds.has(s._id)}
            onSelect={onSelect}
            onClose={handleClose}
          />
        ))}
      </div>
    </>
  );
});
