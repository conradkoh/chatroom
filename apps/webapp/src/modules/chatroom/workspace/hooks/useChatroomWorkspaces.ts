'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo, useCallback } from 'react';

import type { Workspace } from '../../types/workspace';

/**
 * Hook that returns registered workspaces for a chatroom from the workspace registry.
 * Also provides a removeWorkspace callback for the trash icon.
 *
 * This replaces the previous implementation that derived workspaces from
 * `getAgentStatus`. The workspace registry is the persistent source of truth.
 */
export function useChatroomWorkspaces(chatroomId: string) {
  const registryResult = useSessionQuery(api.workspaces.listWorkspacesForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const removeWorkspaceMutation = useSessionMutation(api.workspaces.removeWorkspace);

  const workspaces = useMemo<Workspace[]>(() => {
    if (!registryResult) return [];
    return registryResult
      .filter((ws) => ws.workingDir && ws.machineId)
      .map((ws) => ({
        id: `${ws.machineId}::${ws.workingDir}`,
        machineId: ws.machineId,
        hostname: ws.hostname,
        workingDir: ws.workingDir,
        agentRoles: [], // Registry doesn't track roles — agents derive from agent configs separately
        _registryId: ws._id,
      }));
  }, [registryResult]);

  const removeWorkspace = useCallback(
    async (workspaceRegistryId: string) => {
      await removeWorkspaceMutation({
        workspaceId: workspaceRegistryId as Id<'chatroom_workspaces'>,
      });
    },
    [removeWorkspaceMutation]
  );

  return {
    workspaces,
    isLoading: registryResult === undefined,
    removeWorkspace,
  };
}
