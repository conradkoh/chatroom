import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import { createWorkspaceMembershipSource } from '../../../services/workspace-service/infrastructure/workspace-membership-source.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export interface GitRequestSubscriberHandle {
  stop(): Promise<void>;
}

interface PendingGitRequest {
  _id: string | { toString(): string };
}

/**
 * The requestId on the one drain trigger sent after the first membership snapshot. The inbound
 * handler drains every pending request on the machine and never reads this id, so it is not a real
 * request id.
 */
const STARTUP_DRAIN_REQUEST_ID = 'startup-drain';

function requestId(req: PendingGitRequest): string {
  return typeof req._id === 'string' ? req._id : req._id.toString();
}

/**
 * Watches pending git diff/commit requests per registered workspace.
 *
 * Membership comes from the registered-directory subscription, the same query the WorkspaceService
 * uses. Each registered directory gets one child watch on its pending requests. A membership change
 * adds or removes watches without restarting the subscriber, so a workspace is watched whether or not
 * it was observed at daemon startup. A request in one workspace never invalidates another workspace's
 * watch. The first membership snapshot also triggers one machine-wide drain, which serves any requests
 * that arrived before their watch existed.
 */
export function startGitRequestSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): GitRequestSubscriberHandle {
  const seen = new Set<string>();
  const watchers = new Map<string, () => void>();
  let stopped = false;
  let startupDrainSent = false;
  let unsubscribeMembership: (() => void) | null = null;

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

  /** Makes the watches match `workingDirs`: unwatch the removed directories, watch the new ones. */
  const reconcileWatchers = (workingDirs: ReadonlySet<string>): void => {
    for (const [workingDir, unsub] of watchers) {
      if (workingDirs.has(workingDir)) continue;
      unsub();
      watchers.delete(workingDir);
    }
    for (const workingDir of workingDirs) watchWorkspace(workingDir);
  };

  const membership = createWorkspaceMembershipSource({
    wsClient: deps.wsClient,
    sessionId: deps.sessionId,
    machineId: deps.machineId,
  });
  unsubscribeMembership = membership.subscribe((workingDirs) => {
    if (stopped) return;
    reconcileWatchers(new Set(workingDirs));
    if (!startupDrainSent) {
      startupDrainSent = true;
      onEvent({ type: 'git.request', requestId: STARTUP_DRAIN_REQUEST_ID });
    }
  });

  return {
    async stop() {
      stopped = true;
      // Membership first, so no new watch can be created while the watches are torn down.
      unsubscribeMembership?.();
      unsubscribeMembership = null;
      for (const unsub of watchers.values()) unsub();
      watchers.clear();
    },
  };
}
