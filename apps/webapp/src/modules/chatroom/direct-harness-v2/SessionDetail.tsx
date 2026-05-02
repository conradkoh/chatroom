'use client';

import { useSessionQuery } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { StatusDot } from './StatusDot';
import { SessionMessageStream } from './SessionMessageStream';
import { SessionComposer } from './SessionComposer';
import { relativeTime } from './utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionDetailProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
}

// ─── SessionDetail ────────────────────────────────────────────────────────────

export function SessionDetail({ sessionRowId }: SessionDetailProps) {
  const session = useSessionQuery(api.chatroom.directHarness.sessions.getSession, {
    harnessSessionRowId: sessionRowId,
  });

  if (session === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Session unavailable.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} />
          <span className="text-sm font-semibold text-foreground">{session.agent}</span>
          <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {session.harnessName}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Started {relativeTime(session.createdAt)} · Last active {relativeTime(session.lastActiveAt)}
        </div>
      </div>
      {/* Message stream */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <SessionMessageStream sessionRowId={sessionRowId} />
      </div>
      {/* Composer */}
      <SessionComposer sessionRowId={sessionRowId} status={session.status} />
    </div>
  );
}
