'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';

/**
 * Returns every active workspace across the current user's owned chatrooms.
 */
export function useAllWorkspaces() {
  const result = useSessionQuery(api.workspaces.listAllWorkspaces);

  return {
    workspaces: result ?? [],
    isLoading: result === undefined,
  };
}

/** A single registered workspace as returned by useAllWorkspaces. */
export type AllWorkspaceRow = ReturnType<typeof useAllWorkspaces>['workspaces'][number];
