import { Effect } from 'effect';

import { runIncrementalSubscribeLive } from '../../../../infrastructure/incremental-sync/feed-runtime.js';
import {
  ASSIGNED_TASK_PRESENCE_FEED_BUFFER,
  ASSIGNED_TASK_PRESENCE_FEED_LIMIT,
  assignedTaskPresenceFeedDef,
  assignedTaskPresenceSubscribeTarget,
} from '../../../../infrastructure/incremental-sync/feeds/assigned-task-presence.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

export function startAssignedTaskPresenceSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  let stopped = false;

  const startPromise = Effect.runPromise(
    runIncrementalSubscribeLive({
      wsClient: deps.wsClient,
      def: assignedTaskPresenceFeedDef,
      target: assignedTaskPresenceSubscribeTarget,
      args: { sessionId: deps.sessionId, machineId: deps.machineId },
      buffer: ASSIGNED_TASK_PRESENCE_FEED_BUFFER,
      subscribe: { limit: ASSIGNED_TASK_PRESENCE_FEED_LIMIT },
      onItem: ({ item, ack }) =>
        Effect.sync(() => {
          if (stopped) return;
          ack();
          onEvent({ type: 'assigned-task.presence', taskId: item.taskId, role: item.role });
        }),
      onError: (err) => {
        console.warn(`[daemon] assigned-task-presence subscriber error: ${String(err)}`);
      },
    })
  );

  let feedHandle: Awaited<typeof startPromise> | undefined;
  void startPromise.then((handle) => {
    feedHandle = handle;
  });

  return {
    async stop() {
      stopped = true;
      const handle = feedHandle ?? (await startPromise);
      await Effect.runPromise(handle.stop());
    },
  };
}
