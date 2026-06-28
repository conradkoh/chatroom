'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionSummary } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { EditableSessionTitle } from './EditableSessionTitle';
import { SessionComposer } from './SessionComposer';
import { SessionMessageStream } from './SessionMessageStream';
import { StatusDot } from './StatusDot';
import { Button } from './ui/button';

interface SessionDetailProps {
  sessionRowId: Id<'chatroom_harnessSessions'>;
  sessionSummary: HarnessSessionSummary;
}

export function SessionDetail({ sessionRowId, sessionSummary }: SessionDetailProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshSessionTitle = useSessionMutation(
    api.web.directHarness.commands.refreshSessionTitle
  );

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshSessionTitle({ harnessSessionId: sessionRowId });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="shrink-0 border-b-2 border-border px-4 py-2.5 flex items-center gap-2">
        <StatusDot status={sessionSummary.status} />
        <EditableSessionTitle harnessSessionId={sessionRowId} sessionSummary={sessionSummary} />
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-6 w-6 shrink-0"
          title="Refresh session title"
          disabled={isRefreshing}
          onClick={() => void handleRefresh()}
        >
          <RotateCcw size={12} className={isRefreshing ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <SessionMessageStream sessionRowId={sessionRowId} />
      </div>

      {/* Composer */}
      <SessionComposer
        sessionRowId={sessionRowId}
        status={sessionSummary.status}
        workspaceId={sessionSummary.workspaceId}
        harnessName={sessionSummary.harnessName}
        lastUsedConfig={sessionSummary.lastUsedConfig}
      />
    </div>
  );
}
