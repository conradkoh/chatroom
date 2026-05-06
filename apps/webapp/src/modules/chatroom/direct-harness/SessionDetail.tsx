'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionSummary } from './hooks/useListSessions';

import { SessionComposer } from './SessionComposer';
import { SessionMessageStream } from './SessionMessageStream';
import { SessionParamsPopover } from './SessionParamsPopover';
import { StatusDot } from './StatusDot';
import { relativeTime } from './utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionDetailProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
  sessionSummary: HarnessSessionSummary;
}

// ─── SessionDetail ────────────────────────────────────────────────────────────

export function SessionDetail({ sessionRowId, sessionSummary }: SessionDetailProps) {
  const session = sessionSummary;


  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} />
          <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {session.harnessName}
          </span>
          <SessionParamsPopover
            harnessSessionRowId={session._id}
            workspaceId={session.workspaceId}
            harnessName={session.harnessName}
            lastUsedConfig={session.lastUsedConfig}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Started {relativeTime(session.createdAt)} · Last active{' '}
          {relativeTime(session.lastActiveAt)}
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
