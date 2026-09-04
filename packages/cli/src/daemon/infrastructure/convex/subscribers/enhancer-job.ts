import type { FunctionReturnType } from 'convex/server';

import { api, type Id } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export interface EnhancerJobSubscriberHandle {
  stop(): Promise<void>;
  refreshChatrooms(): Promise<void>;
}

type WorkspaceForMachineView = NonNullable<
  FunctionReturnType<typeof api.workspaces.listWorkspacesForMachine>
>[number];

interface PendingEnhancerJob {
  jobId: string;
}

/**
 * Watches pending enhancer jobs per chatroom.
 *
 * One child subscription per active chatroom (discovered via
 * listWorkspacesForMachine, deduped because a room can have many workspaces)
 * so an enhancer-job write in one room never invalidates the watch for
 * another room on the same machine. The machine-wide pendingForMachine query
 * remains an imperative recovery drain in the legacy worker, not a WS watch.
 */
// fallow-ignore-next-line complexity
export function startEnhancerJobSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): EnhancerJobSubscriberHandle {
  const seen = new Set<string>();
  const watchers = new Map<string, () => void>();
  let stopped = false;
  let refreshInFlight = false;

  // fallow-ignore-next-line complexity
  const onPendingJobs = (jobs: PendingEnhancerJob[] | null) => {
    if (!jobs?.length) return;
    for (const job of jobs) {
      if (job == null || typeof job !== 'object' || !('jobId' in job)) continue;
      if (seen.has(job.jobId)) continue;
      seen.add(job.jobId);
      onEvent({ type: 'enhancer.job-assigned', jobId: job.jobId });
    }
  };

  const onError = (err: unknown) => {
    console.warn(
      `[daemon] enhancer-job subscriber error: ${err instanceof Error ? err.message : String(err)}`
    );
  };

  const watchChatroom = (chatroomId: string): void => {
    if (watchers.has(chatroomId) || stopped) return;
    const unsub = deps.wsClient.onUpdate(
      api.daemon.enhancer.index.pendingForChatroom,
      {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      },
      // fallow-ignore-next-line complexity
      onPendingJobs,
      onError
    );
    watchers.set(chatroomId, unsub);
  };

  /** Reconcile child watches against the machine's active chatrooms. Idempotent + coalesced. */
  // fallow-ignore-next-line complexity
  const refreshChatrooms = async (): Promise<void> => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      const workspaces = await deps.wsClient.query(api.workspaces.listWorkspacesForMachine, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
      });
      if (stopped) return;
      const roomIds: string[] = [
        ...new Set((workspaces ?? ([] as WorkspaceForMachineView[])).map((ws) => ws.chatroomId)),
      ];
      for (const [roomId, unsub] of watchers) {
        if (!roomIds.includes(roomId)) {
          unsub();
          watchers.delete(roomId);
        }
      }
      for (const roomId of roomIds) watchChatroom(roomId);
    } catch (error) {
      console.warn(
        `[daemon] enhancer-job room refresh failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      refreshInFlight = false;
    }
  };

  void refreshChatrooms();

  return {
    async stop() {
      stopped = true;
      for (const unsub of watchers.values()) unsub();
      watchers.clear();
    },
    refreshChatrooms,
  };
}
