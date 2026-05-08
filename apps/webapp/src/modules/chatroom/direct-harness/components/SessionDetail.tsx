'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionSummary } from '@workspace/backend/src/domain/direct-harness/types';
import { SessionComposer } from './SessionComposer';
import { SessionMessageStream } from './SessionMessageStream';
import { StatusDot } from './StatusDot';
import { displaySessionTitle } from './SessionList';

interface SessionDetailProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
  sessionSummary: HarnessSessionSummary;
}

export function SessionDetail({ sessionRowId, sessionSummary }: SessionDetailProps) {
  const title = displaySessionTitle(sessionSummary);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Minimal header */}
      <div className="shrink-0 border-b-2 border-border px-4 py-2.5 flex items-center gap-2">
        <StatusDot status={sessionSummary.status} />
        <span className="text-sm font-bold text-foreground truncate">{title}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <SessionMessageStream sessionRowId={sessionRowId} />
      </div>

      {/* Composer */}
      <SessionComposer sessionRowId={sessionRowId} status={sessionSummary.status} />
    </div>
  );
}
