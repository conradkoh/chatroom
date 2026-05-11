'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Trigger a capabilities refresh on the daemon for the given workspace.
 * Returns a stable refresh function reference.
 */
export function useRefreshCapabilities() {
  const mutate = useSessionMutation(api.web.directHarness.commands.refreshCapabilities);

  const refresh = useCallback(
    (workspaceId: Id<'chatroom_workspaces'>) => {
      void mutate({ workspaceId });
    },
    [mutate]
  );

  return { refresh };
}
