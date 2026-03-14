'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { WorkspaceView } from '@workspace/backend/src/domain/usecase/chatroom/get-agent-statuses';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useWorkspaces } from '../../hooks/useWorkspaces';
import type { Workspace } from '../../types/workspace';

/**
 * Lightweight hook that returns workspace data for use in the chatroom dashboard.
 *
 * Reuses the same `getAgentStatus` query as `useAgentPanelData`, but only
 * exposes workspace-level data (no per-agent status details).
 *
 * Filters out unassigned workspaces and workspaces without a workingDir / machineId.
 */
export function useChatroomWorkspaces(chatroomId: string): {
  workspaces: Workspace[];
  isLoading: boolean;
} {
  const statusResult = useSessionQuery(api.machines.getAgentStatus, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const backendWorkspaces = useMemo<WorkspaceView[]>(
    () => statusResult?.workspaces ?? [],
    [statusResult?.workspaces],
  );

  const { allWorkspaces } = useWorkspaces({
    agents: statusResult?.agents?.map((a) => ({ role: a.role })) ?? [],
    backendWorkspaces,
  });

  // Filter out unassigned and workspaces without workingDir / machineId
  const workspaces = useMemo(
    () => allWorkspaces.filter((w) => w.workingDir && w.machineId),
    [allWorkspaces],
  );

  return { workspaces, isLoading: statusResult === undefined };
}
