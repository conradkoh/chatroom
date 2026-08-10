'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery } from 'convex-helpers/react/sessions';

/** A single registered workspace as returned by listAllWorkspaces. */
export interface AllWorkspaceRow {
  _id: string;
  chatroomId: string;
  chatroomName: string;
  machineId: string;
  workingDir: string;
  hostname: string;
  machineAlias?: string;
  registeredAt: number;
  registeredBy: string;
}

/**
 * Returns every active workspace across the current user's owned chatrooms.
 */
export function useAllWorkspaces() {
  const result = useSessionQuery(api.workspaces.listAllWorkspaces);

  return {
    workspaces: (result ?? []) as AllWorkspaceRow[],
    isLoading: result === undefined,
  };
}
