'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo, useCallback } from 'react';

import type { Workspace } from '../../types/workspace';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseChatroomWorkspacesOptions {
  /** Optional: agent views to enrich workspaces with agentRoles (matched by workingDir) */
  agentViews?: Array<{ role: string; workingDir?: string }>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook that returns registered workspaces for a chatroom from the workspace registry.
 * Optionally enriches workspaces with `agentRoles` when `agentViews` is provided.
 * Also provides a `removeWorkspace` callback for the trash icon.
 */
export function useChatroomWorkspaces(
  chatroomId: string,
  options?: UseChatroomWorkspacesOptions
) {
  const registryResult = useSessionQuery(api.workspaces.listWorkspacesForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const removeWorkspaceMutation = useSessionMutation(api.workspaces.removeWorkspace);

  const workspaces = useMemo<Workspace[]>(() => {
    if (!registryResult) return [];
    return registryResult
      .filter((ws) => ws.workingDir && ws.machineId)
      .map((ws) => {
        // If agentViews provided, derive agentRoles from agents with matching workingDir
        const agentRoles = options?.agentViews
          ? options.agentViews.filter((a) => a.workingDir === ws.workingDir).map((a) => a.role)
          : [];
        return {
          id: `${ws.machineId}::${ws.workingDir}`,
          machineId: ws.machineId,
          hostname: ws.hostname,
          machineAlias: ws.machineAlias,
          workingDir: ws.workingDir,
          agentRoles,
          _registryId: ws._id,
        };
      });
  }, [registryResult, options?.agentViews]);

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
