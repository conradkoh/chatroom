'use client';

/**
 * useChatroomActiveWorkspace — single source of truth for the "active workspace"
 * used by the file explorer, Cmd+P, git panel, and any other surface that needs
 * to operate on one workspace at a time within a chatroom.
 *
 * Decision logic: pick the workspace at `activeWorkspaceIndex` (defaults to 0)
 * from the filtered list of workspaces that have a connected machineId.
 *
 * Returning `workspaces` alongside `activeWorkspace` lets callers that need the
 * full list (e.g. multi-workspace file subscriptions) avoid a second hook call.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useMemo } from 'react';

import { useChatroomWorkspaces } from '../workspace/hooks/useChatroomWorkspaces';
import type { Workspace } from '../types/workspace';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatroomActiveWorkspace {
  /** Convex registry ID for the workspace (null when not yet registered). */
  workspaceId: string | null; // registry key from Workspace.id (not a Convex _id)
  /** machineId of the connected daemon. */
  machineId: string | null;
  /** Absolute working-directory path. */
  workingDir: string | null;
  /** Display hostname (alias if set, otherwise hostname). */
  hostname: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the currently-active workspace for a chatroom and the full workspace list.
 *
 * @param chatroomId  The chatroom to look up workspaces for.
 * @param activeWorkspaceIndex  Index into the list of connected workspaces (default: 0).
 *                              The caller owns the index state for future multi-workspace switching.
 */
export function useChatroomActiveWorkspace(
  chatroomId: Id<'chatroom_rooms'>,
  activeWorkspaceIndex = 0
): {
  activeWorkspace: ChatroomActiveWorkspace | null;
  workspaces: Workspace[];
} {
  const { workspaces } = useChatroomWorkspaces(chatroomId);

  // Only workspaces with a connected machine are eligible as the active workspace.
  const connectedWorkspaces = workspaces.filter((ws) => ws.machineId);
  const selected = connectedWorkspaces[activeWorkspaceIndex] ?? null;

  // Memoize activeWorkspace to stabilise its reference between renders.
  // Without this, every render creates a new object, which causes infinite
  // re-render loops when the object is used in useEffect dependency arrays
  // (e.g. the HeaderPortalProvider effect in ChatroomDashboard).
  const activeWorkspace: ChatroomActiveWorkspace | null = useMemo(
    () =>
      selected
        ? {
            workspaceId: selected._registryId ?? null,
            machineId: selected.machineId,
            workingDir: selected.workingDir || null,
            hostname: selected.machineAlias ?? selected.hostname ?? null,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitive values only; object identity not needed
    [
      selected?._registryId,
      selected?.machineId,
      selected?.workingDir,
      selected?.machineAlias,
      selected?.hostname,
    ]
  );

  // Stabilise the return object so callers that destructure don't get a fresh
  // reference each render.
  return useMemo(
    () => ({ activeWorkspace, workspaces }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activeWorkspace is already memoised; workspaces is referentially stable from Convex
    [activeWorkspace, workspaces]
  );
}
