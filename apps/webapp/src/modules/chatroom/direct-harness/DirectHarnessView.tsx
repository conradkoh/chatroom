'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { memo, useEffect, useState } from 'react';

import { NewSessionForm } from './NewSessionForm';
import { SessionDetail } from './SessionDetail';
import { SessionList } from './SessionList';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface DirectHarnessViewProps {
  chatroomId: Id<'chatroom_rooms'>;
}

export const DirectHarnessView = memo(function DirectHarnessView({
  chatroomId,
}: DirectHarnessViewProps) {
  const workspaces = useSessionQuery(api.workspaces.listWorkspacesForChatroom, { chatroomId });
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<Id<'chatroom_workspaces'> | null>(
    null
  );
  const [selectedSessionId, setSelectedSessionId] = useState<Id<'chatroom_harnessSessions'> | null>(
    null
  );

  // Auto-select first workspace once they load (and only if nothing selected yet)
  useEffect(() => {
    if (selectedWorkspaceId !== null) return;
    if (!workspaces || workspaces.length === 0) return;
    setSelectedWorkspaceId(workspaces[0]._id);
  }, [workspaces, selectedWorkspaceId]);

  // Reset session selection whenever workspace changes
  useEffect(() => {
    setSelectedSessionId(null);
  }, [selectedWorkspaceId]);

  // Loading state — query returns undefined while in flight
  if (workspaces === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Loading workspaces…
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Left pane — switcher + session list */}
      <div className="w-72 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
        <div className="shrink-0 border-b border-border p-2">
          <WorkspaceSwitcher
            workspaces={workspaces}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelect={setSelectedWorkspaceId}
          />
        </div>
        {selectedWorkspaceId ? (
          <>
            <SessionList
              workspaceId={selectedWorkspaceId}
              selectedSessionId={selectedSessionId}
              onSelect={setSelectedSessionId}
            />
            <div className="shrink-0 border-t border-border p-2">
              <NewSessionForm
                workspaceId={selectedWorkspaceId}
                onSessionCreated={setSelectedSessionId}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
            Select a workspace to begin.
          </div>
        )}
      </div>
      {/* Right pane — session detail */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {selectedSessionId ? (
          <SessionDetail sessionRowId={selectedSessionId} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            {selectedWorkspaceId ? 'Select a session.' : 'No workspace selected.'}
          </div>
        )}
      </div>
    </div>
  );
});
