// Reason: the WorkspaceService (S4b-2) is the first production consumer; S5 wires it.
// fallow-ignore-file unused-file
import type { SessionId } from 'convex-helpers/server/sessions';
import { z } from 'zod';

import { api } from '../../../../api.js';
import type { WorkspaceActivityRow } from '../domain/observation-tier.js';

/** Live subscription surface of the Convex WebSocket client. Matches `ConvexClient.onUpdate`. */
export type ConvexWsClientLike = {
  onUpdate(
    query: typeof api.workspaces.listWorkspaceActivityForMachine,
    args: { sessionId: SessionId; machineId: string },
    callback: (rows: unknown) => void,
    onError: (error: Error) => void
  ): () => void;
};

export type WorkspaceActivitySource = {
  /**
   * Delivers each snapshot of the machine's active workspaces to `onRows`. Returns an
   * unsubscribe function; after it returns, `onRows` is not called again.
   */
  subscribe(onRows: (rows: readonly WorkspaceActivityRow[]) => void): () => void;
};

/**
 * One row of `listWorkspaceActivityForMachine`. `strictObject` rejects unknown keys, so a backend
 * shape change is caught here instead of being silently ignored.
 */
const workspaceActivityRowSchema = z.strictObject({
  workingDir: z.string(),
  lastObservedAt: z.number().nullable(),
});

/**
 * Parses one snapshot. Returns null when the payload is not an array, so the caller skips the
 * update and keeps the previous membership. An invalid row is logged and dropped; the others
 * are kept.
 *
 * Constraint: a dropped row removes its workspace from membership on this snapshot, the same as
 * a row that is absent from the backend result.
 */
function parseWorkspaceActivityRows(payload: unknown): WorkspaceActivityRow[] | null {
  if (!Array.isArray(payload)) {
    console.error('[workspace-activity] snapshot is not an array; skipping update');
    return null;
  }
  const rows: WorkspaceActivityRow[] = [];
  for (const raw of payload) {
    const parsed = workspaceActivityRowSchema.safeParse(raw);
    if (parsed.success) {
      rows.push(parsed.data);
    } else {
      console.error(
        '[workspace-activity] dropping row that deviates from the schema:',
        parsed.error
      );
    }
  }
  return rows;
}

/**
 * Subscribes to the active workspaces of `machineId`. Each parsed snapshot is handed to the
 * caller as-is; membership and normalization are decided by the service, not here.
 */
// Reason: the daemon constructs this source in S5, which is its first production consumer.
// fallow-ignore-next-line unused-export
export function createWorkspaceActivitySource(args: {
  wsClient: ConvexWsClientLike;
  sessionId: SessionId;
  machineId: string;
}): WorkspaceActivitySource {
  const { wsClient, sessionId, machineId } = args;
  return {
    subscribe(onRows) {
      let active = true;
      const unsubscribe = wsClient.onUpdate(
        api.workspaces.listWorkspaceActivityForMachine,
        { sessionId, machineId },
        (payload) => {
          if (!active) return;
          const rows = parseWorkspaceActivityRows(payload);
          if (rows !== null) onRows(rows);
        },
        (error) => console.warn(`[workspace-activity] subscription error: ${error.message}`)
      );
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}
