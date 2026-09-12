'use client';

/**
 * useChatroomActiveWorkspace — single source of truth for the "active workspace"
 * used by the file explorer, Cmd+P, git panel, and any other surface that needs
 * to operate on one workspace at a time within a chatroom.
 *
 * The selected workspace comes from ChatroomWorkspaceProvider, which reads the
 * authoritative chatroom primary-workspace selection. This adapter keeps the
 * existing machine/path shape used by file and command surfaces.
 */

import { useMemo } from 'react';

import { useChatroomWorkspace } from '../context/ChatroomWorkspaceContext';
import type { Workspace } from '../types/workspace';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatroomActiveWorkspace {
  /** Convex registry document ID (`chatroom_workspaces._id`). */
  workspaceId: string | null;
  /** machineId associated with the workspace. */
  machineId: string | null;
  /** Absolute working-directory path. */
  workingDir: string | null;
  /** Display hostname (alias if set, otherwise hostname). */
  hostname: string | null;
  /** Whether this workspace syncs file-tree data to Chatroom. */
  fileTreeSyncEnabled: boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the currently-active workspace for a chatroom and the full workspace list.
 *
 * The provider supplies the chatroom identity and selection; callers do not
 * maintain a local index or selection state.
 */
export function useChatroomActiveWorkspace(): {
  activeWorkspace: ChatroomActiveWorkspace | null;
  workspaces: Workspace[];
  isLoading: boolean;
} {
  const { workspaces, activeWorkspace: selected, isLoading } = useChatroomWorkspace();

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
            fileTreeSyncEnabled: selected.fileTreeSyncEnabled,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- primitive values only; object identity not needed
    [
      selected?._registryId,
      selected?.machineId,
      selected?.workingDir,
      selected?.machineAlias,
      selected?.hostname,
      selected?.fileTreeSyncEnabled,
    ]
  );

  // Stabilise the return object so callers that destructure don't get a fresh
  // reference each render.
  return useMemo(
    () => ({ activeWorkspace, workspaces, isLoading }),

    [activeWorkspace, workspaces, isLoading]
  );
}
