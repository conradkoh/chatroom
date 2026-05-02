'use client';

import { memo, useEffect, useState } from 'react';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { WorkspaceSwitcher } from './WorkspaceSwitcher';

interface DirectHarnessViewProps {
  chatroomId: Id<'chatroom_rooms'>;
}

export const DirectHarnessView = memo(function DirectHarnessView({
  chatroomId,
}: DirectHarnessViewProps) {
  const workspaces = useSessionQuery(api.workspaces.listWorkspacesForChatroom, { chatroomId });
  const [selectedWorkspaceId, setSelectedWorkspaceId] =
    useState<Id<'chatroom_workspaces'> | null>(null);

  // Auto-select first workspace once they load (and only if nothing selected yet)
  useEffect(() => {
    if (selectedWorkspaceId !== null) return;
    if (!workspaces || workspaces.length === 0) return;
    setSelectedWorkspaceId(workspaces[0]._id);
  }, [workspaces, selectedWorkspaceId]);

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
      {/* Left pane — switcher + (future) session list */}
      <div className="w-72 shrink-0 border-r border-border bg-card flex flex-col min-h-0">
        <div className="shrink-0 border-b border-border p-2">
          <WorkspaceSwitcher
            workspaces={workspaces}
            selectedWorkspaceId={selectedWorkspaceId}
            onSelect={setSelectedWorkspaceId}
          />
        </div>
        {/* c3 will add SessionList here */}
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
          {selectedWorkspaceId ? 'Sessions list coming in c3.' : 'Select a workspace to begin.'}
        </div>
      </div>
      {/* Right pane — (future) session detail */}
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {selectedWorkspaceId ? 'Select a session.' : 'No workspace selected.'}
      </div>
    </div>
  );
});
