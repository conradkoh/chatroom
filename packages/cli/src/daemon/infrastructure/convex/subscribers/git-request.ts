import type { FunctionReturnType } from 'convex/server';

import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export interface GitRequestSubscriberHandle {
  stop(): Promise<void>;
  refreshWorkspaces(): Promise<void>;
}

type WorkspaceForMachineView = NonNullable<
  FunctionReturnType<typeof api.workspaces.listWorkspacesForMachine>
>[number];

interface PendingGitRequest {
  _id: string | { toString(): string };
}

function requestId(req: PendingGitRequest): string {
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

/**
 * Watches pending git diff/commit requests per workspace.
 *
 * One child subscription per active workspace (workingDir, discovered via
 * listWorkspacesForMachine and deduped) so a request in one workspace never
 * invalidates the watch for another workspace on the same machine. The
 * machine-wide getPendingRequests query remains an imperative recovery drain
 * in the legacy worker, not a WS watch.
 */
export function startGitRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): GitRequestSubscriberHandle {
  const seen = new Set<string>();
  const watchers = new Map<string, () => void>();
  let stopped = false;
  let refreshInFlight = false;
  let queued = false;

  // fallow-ignore-next-line complexity
  const onPendingRequests = (requests: PendingGitRequest[] | null) => {
    if (!requests?.length) return;
    for (const req of requests) {
      if (req == null || typeof req !== 'object' || !('_id' in req)) continue;
      const id = requestId(req);
      if (seen.has(id)) continue;
      seen.add(id);
      onEvent({ type: 'git.request', requestId: id });
    }
  };

  const onError = (err: unknown) => {
    console.warn(
      `[daemon] git-request subscriber error: ${err instanceof Error ? err.message : String(err)}`
    );
  };

  const watchWorkspace = (workingDir: string): void => {
    if (watchers.has(workingDir) || stopped) return;
    const unsub = deps.wsClient.onUpdate(
      api.workspaces.getPendingRequestsForWorkspace,
      { sessionId: deps.sessionId, machineId: deps.machineId, workingDir },
      onPendingRequests,
      onError
    );
    watchers.set(workingDir, unsub);
  };

  /** Reconcile child watches against the machine's active workspaces. Idempotent + coalesced. */
  // fallow-ignore-next-line complexity
  const refreshWorkspaces = async (): Promise<void> => {
    if (refreshInFlight) {
      queued = true;
      return;
    }
    refreshInFlight = true;
    try {
      do {
        queued = false;
        const workspaces = await deps.wsClient.query(api.workspaces.listWorkspacesForMachine, {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        if (stopped) return;
        const workingDirs = [
          ...new Set((workspaces ?? ([] as WorkspaceForMachineView[])).map((ws) => ws.workingDir)),
        ];
        for (const [workingDir, unsub] of watchers) {
          if (!workingDirs.includes(workingDir)) {
            unsub();
            watchers.delete(workingDir);
          }
        }
        for (const workingDir of workingDirs) watchWorkspace(workingDir);
      } while (queued && !stopped);
    } catch (error) {
      console.warn(
        `[daemon] git-request workspace refresh failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      refreshInFlight = false;
    }
  };

  void refreshWorkspaces();

  return {
    async stop() {
      stopped = true;
      for (const unsub of watchers.values()) unsub();
      watchers.clear();
    },
    refreshWorkspaces,
  };
}
