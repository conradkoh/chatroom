// fallow-ignore-file unused-file
// Unused until slice 5b wires it into the WorkspaceService. Remove this line when it is wired.
import type { SessionId } from 'convex-helpers/server/sessions';
import { z } from 'zod';

import { api } from '../../../../api.js';

/** Live subscription surface of the Convex WebSocket client. Matches `ConvexClient.onUpdate`. */
export type ConvexWsClientLike = {
  onUpdate(
    query: typeof api.workspaces.listRegisteredWorkingDirsForMachine,
    args: { sessionId: SessionId; machineId: string },
    callback: (workingDirs: unknown) => void,
    onError: (error: Error) => void
  ): () => void;
};

export type WorkspaceMembershipSource = {
  /**
   * Delivers each snapshot of the machine's registered working directories to `onWorkingDirs`.
   * Returns an unsubscribe function; after it returns, `onWorkingDirs` is not called again.
   */
  subscribe(onWorkingDirs: (workingDirs: readonly string[]) => void): () => void;
};

/** A snapshot is an array of strings. Empty is a valid membership, not an error. */
const workingDirsSchema = z.array(z.string());

/**
 * Parses one snapshot. Returns null when the payload is not an array of strings, so the caller
 * skips it and keeps the previous membership. The whole snapshot is ignored, not the bad element,
 * so one malformed entry cannot silently remove a monitored directory.
 */
function parseWorkingDirs(payload: unknown): readonly string[] | null {
  const parsed = workingDirsSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn('[workspace-membership] ignoring snapshot that is not an array of strings');
    return null;
  }
  return parsed.data;
}

/**
 * Subscribes to the registered working directories of `machineId`. Each valid snapshot is handed
 * to the caller as received. Normalization and diffing happen in the domain, not here.
 */
export function createWorkspaceMembershipSource(args: {
  wsClient: ConvexWsClientLike;
  sessionId: SessionId;
  machineId: string;
}): WorkspaceMembershipSource {
  const { wsClient, sessionId, machineId } = args;
  return {
    subscribe(onWorkingDirs) {
      let active = true;
      const unsubscribe = wsClient.onUpdate(
        api.workspaces.listRegisteredWorkingDirsForMachine,
        { sessionId, machineId },
        (payload) => {
          if (!active) return;
          const workingDirs = parseWorkingDirs(payload);
          if (workingDirs !== null) onWorkingDirs(workingDirs);
        },
        (error) => console.warn(`[workspace-membership] subscription error: ${error.message}`)
      );
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}
