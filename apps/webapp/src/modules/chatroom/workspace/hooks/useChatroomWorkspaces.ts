'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { useMemo, useCallback } from 'react';

import type { Workspace } from '../../types/workspace';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

// ─── Dedup ────────────────────────────────────────────────────────────────────

/** Merge two registry rows that share the same machineId + normalized workingDir. */
function mergeWorkspaceEntries(existing: Workspace, incoming: Workspace): Workspace {
  const existingAt = existing.registeredAt ?? 0;
  const incomingAt = incoming.registeredAt ?? 0;
  const primary = incomingAt >= existingAt ? incoming : existing;
  return {
    ...primary,
    agentRoles: [...new Set([...existing.agentRoles, ...incoming.agentRoles])],
  };
}

/** Collapse duplicate registry rows to one workspace per `${machineId}::${workingDir}` id. */
// fallow-ignore-next-line unused-export
export function dedupeWorkspacesById(workspaces: Workspace[]): Workspace[] {
  const byId = new Map<string, Workspace>();
  for (const ws of workspaces) {
    const existing = byId.get(ws.id);
    byId.set(ws.id, existing ? mergeWorkspaceEntries(existing, ws) : ws);
  }
  return Array.from(byId.values());
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseChatroomWorkspacesOptions {
  /** Optional: agent views to enrich workspaces with agentRoles (matched by workingDir) */
  agentViews?: { role: string; workingDir?: string }[];
  /** When true, no workspace registry subscription (workspaces stay empty). */
  skip?: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Hook that returns registered workspaces for a chatroom from the workspace registry.
 * Optionally enriches workspaces with `agentRoles` when `agentViews` is provided.
 * Also provides a `removeWorkspace` callback for the trash icon.
 */
export function useChatroomWorkspaces(chatroomId: string, options?: UseChatroomWorkspacesOptions) {
  const registryResult = useSessionQuery(
    api.workspaces.listWorkspacesForChatroom,
    options?.skip === true ? 'skip' : { chatroomId: chatroomId as Id<'chatroom_rooms'> }
  );

  const removeWorkspaceMutation = useSessionMutation(api.workspaces.removeWorkspace);

  const workspaces = useMemo<Workspace[]>(() => {
    if (!registryResult) return [];
    const mapped = registryResult
      .filter((ws) => ws.workingDir && ws.machineId)
      .map((ws) => {
        const workingDir = normalizeWorkspaceWorkingDir(ws.workingDir);
        // If agentViews provided, derive agentRoles from agents with matching workingDir
        const agentRoles = options?.agentViews
          ? options.agentViews.filter((a) => a.workingDir === workingDir).map((a) => a.role)
          : [];
        return {
          id: `${ws.machineId}::${workingDir}`,
          machineId: ws.machineId,
          hostname: ws.hostname,
          machineAlias: ws.machineAlias,
          workingDir,
          agentRoles,
          registeredAt: ws.registeredAt,
          _registryId: ws._id,
        };
      });
    return dedupeWorkspacesById(mapped);
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
