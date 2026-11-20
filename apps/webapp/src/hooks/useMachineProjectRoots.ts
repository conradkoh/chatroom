/**
 * Hook for a machine's project roots (`api.machineProjectRoots.*`).
 *
 * Thin wrapper: the server re-checks ownership and online state, so callers shape
 * only the UI. The list subscription lives only while the roots section is mounted,
 * which is why the Machines card renders the section body lazily.
 */

'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

export interface MachineProjectRoot {
  rootId: Id<'chatroom_machineProjectRoots'>;
  path: string;
  addedAt: number;
}

export interface AddProjectRootResult {
  rootId: Id<'chatroom_machineProjectRoots'>;
  /** The server-normalized path. */
  path: string;
  /** Existing child roots the new root replaced (sorted). */
  collapsedPaths: string[];
}

export interface UseMachineProjectRootsResult {
  /** undefined while the first result loads. */
  roots: MachineProjectRoot[] | undefined;
  /** Throws the ConvexError on rejection; resolves with the server-normalized result. */
  addRoot: (path: string) => Promise<AddProjectRootResult>;
  /** Resolves { removed }. removed:false is a success (already gone). */
  removeRoot: (rootId: Id<'chatroom_machineProjectRoots'>) => Promise<{ removed: boolean }>;
}

export function useMachineProjectRoots(machineId: string): UseMachineProjectRootsResult {
  const result = useSessionQuery(api.machineProjectRoots.list, { machineId });
  const add = useSessionMutation(api.machineProjectRoots.add);
  const remove = useSessionMutation(api.machineProjectRoots.remove);

  const addRoot = useCallback(
    async (path: string): Promise<AddProjectRootResult> => {
      const added = await add({ machineId, path });
      return { rootId: added.rootId, path: added.path, collapsedPaths: added.collapsedPaths };
    },
    [add, machineId]
  );

  const removeRoot = useCallback(
    (rootId: Id<'chatroom_machineProjectRoots'>) => remove({ machineId, rootId }),
    [remove, machineId]
  );

  return { roots: result?.roots, addRoot, removeRoot };
}
